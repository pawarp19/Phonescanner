const express = require('express');
const multer = require('multer');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const visionClient = new ImageAnnotatorClient({
  keyFilename: path.join(__dirname, 'googlecloudkey.json')
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection URI
const uri = process.env.MONGODB_URI;

let db;

// Connect to MongoDB
MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    console.log('Connected to MongoDB');
    db = client.db('scanner'); // Replace with your database name
  })
  .catch(err => console.error('Error connecting to MongoDB:', err));

// Middleware to handle MongoDB connection errors
app.use((req, res, next) => {
  if (!db) {
    res.status(500).json({ message: 'Database connection error' });
    return;
  }
  next();
});

// Function to extract phone numbers from image using Google Vision API
const googleVisionApi = async (buffer) => {
  try {
    const [result] = await visionClient.textDetection({ image: { content: buffer } });
    const detections = result.textAnnotations;
    if (detections.length > 0) {
      const parsedText = detections[0].description;
      console.log('Extracted Text:', parsedText);
      return extractPhoneNumbers(parsedText);
    } else {
      throw new Error('No text detected');
    }
  } catch (error) {
    console.error('Error during text detection:', error.message);
    throw error;
  }
};

// Function to extract phone numbers from text
const extractPhoneNumbers = (text) => {
  const allNumbers = text.match(/\d+/g) || [];
  return allNumbers.filter(number => number.length === 10 || number.length === 12);
};

// Function to store scheduled calls in MongoDB
const storeScheduledCalls = async (jobId, phoneNumbers, scheduledDateTime) => {
  const scheduledCallsCollection = db.collection('scheduledCalls');

  const extractedPhoneNumbers = phoneNumbers.map(entry => {
    return entry.split(' ')[0];
  });

  try {
    await scheduledCallsCollection.insertOne({
      jobId,
      phoneNumbers: extractedPhoneNumbers,
      scheduledDateTime: new Date(scheduledDateTime),
      status: 'Pending',
      message: 'Not attempted yet'
    });
    console.log('Scheduled calls stored in MongoDB');
  } catch (error) {
    console.error('Error storing scheduled calls:', error.message);
    throw error;
  }
};

// Function to make a call using an external API
const makeCall = async (phoneNumbers) => {
  const apiId = process.env.BULKSMS_API_ID;
  const apiPassword = process.env.BULKSMS_API_PASSWORD;
  const voiceType = '6';
  const voiceMediasId = '6007';
  const scheduled = '0';

  const params = new URLSearchParams();
  params.append('api_id', apiId);
  params.append('api_password', apiPassword);
  params.append('number', phoneNumbers.join(','));
  params.append('voice_type', voiceType);
  params.append('voice_medias_id', voiceMediasId);
  params.append('scheduled', scheduled);
  params.append('sender', 'HELLOVC');

  try {
    const response = await axios.post('https://www.bulksmsplans.com/api/send_voice_note', params);

    console.log('Voice note sent:', response.data);

    if (response.data && response.data.code === 200) {
      console.log('Voice note sent successfully:', response.data);
      return { success: true, data: response.data };
    } else {
      console.error('Error in API response:', response.data);
      return { success: false, data: response.data };
    }
  } catch (error) {
    console.error('Error sending voice note:', error.message);
    return { success: false, error: error.message };
  }
};

// Route to upload an image and extract phone numbers
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) {
    console.error('No file uploaded');
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    let phoneNumbers = await googleVisionApi(req.file.buffer);
    if (phoneNumbers.length === 0) {
      throw new Error('No valid phone numbers found');
    }
    res.json({ phoneNumbers });
  } catch (error) {
    console.error('Error processing image:', error.message);
    res.status(500).json({ message: 'Error processing the image', error: error.message });
  }
});

// Route to schedule calls and store in MongoDB
app.post('/schedule', async (req, res) => {
  const { phoneNumbers, date, time } = req.body;

  const cleanedPhoneNumbers = phoneNumbers.map(entry => {
    return entry.split(' ')[0];
  });

  const scheduledDateTime = new Date(`${date}T${time}:00`);

  if (scheduledDateTime <= new Date()) {
    return res.status(400).json({ message: 'Scheduled time must be in the future' });
  }

  const cronTime = `${scheduledDateTime.getMinutes()} ${scheduledDateTime.getHours()} ${scheduledDateTime.getDate()} ${scheduledDateTime.getMonth() + 1} *`;

  const jobId = new ObjectId();

  try {
    await storeScheduledCalls(jobId, cleanedPhoneNumbers, scheduledDateTime);
  } catch (error) {
    console.error('Error storing scheduled calls:', error.message);
    return res.status(500).json({ message: 'Failed to store scheduled calls' });
  }

  cron.schedule(cronTime, async () => {
    const result = await makeCall(cleanedPhoneNumbers);
    const statusMessage = result.success ? 'Success' : 'Failed';

    try {
      const scheduledCallsCollection = db.collection('scheduledCalls');
      await scheduledCallsCollection.updateOne(
        { jobId },
        { $set: { status: statusMessage, message: `Scheduled call at ${scheduledDateTime.toString()}: ${statusMessage}` } }
      );
      console.log(`Scheduled call at ${scheduledDateTime.toString()} for ${cleanedPhoneNumbers.length} phone numbers: ${statusMessage}`);
    } catch (error) {
      console.error('Error updating call status:', error.message);
    }
  });

  res.json({ message: 'Call scheduled successfully', jobId: jobId.toHexString() });
});

// Route to fetch scheduled calls
app.get('/scheduled-calls', async (req, res) => {
  try {
    const calls = await db.collection('scheduledCalls').find().toArray();
    res.json(calls);
  } catch (error) {
    console.error('Error fetching scheduled calls:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled calls' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
