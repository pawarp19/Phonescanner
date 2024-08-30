const express = require('express');
const multer = require('multer');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const { MongoClient, ObjectId } = require('mongodb');
const moment = require('moment-timezone');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, 'base64').toString('utf-8'));
const visionClient = new ImageAnnotatorClient({
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  },
});

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

const gm = require('gm').subClass({ imageMagick: true });

const preprocessImage = (buffer) => {
  return new Promise((resolve, reject) => {
    gm(buffer)
      .resize(800) // Example resize operation, adjust as needed
      .toBuffer('PNG', (err, buffer) => {
        if (err) return reject(err);
        resolve(buffer);
      });
  });
};

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
  const allNumbers = text.match(/\d{10}/g) || [];
  return allNumbers;
};

// Function to store scheduled calls in MongoDB
const storeScheduledCalls = async (jobId, phoneNumbers, scheduledDateTime) => {
  const scheduledCallsCollection = db.collection('scheduledCalls');

  try {
    await scheduledCallsCollection.insertOne({
      jobId,
      phoneNumbers,
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
const makeCall = async (phoneNumbers, scheduledDateTime) => {
  const apiId = process.env.BULKSMS_API_ID;
  const apiPassword = process.env.BULKSMS_API_PASSWORD;
  const voiceType = '9'; // Use the appropriate voice type for your needs
  const voiceMediasId = '6603 '; // Replace with your actual voice media ID
  const timezoneId = '53'; // Replace with the correct timezone ID


  const params = new URLSearchParams();
  params.append('api_id', apiId);
  params.append('api_password', apiPassword);
  params.append('number', phoneNumbers.join(','));
  params.append('voice_type', voiceType);
  params.append('voice_medias_id', voiceMediasId);
  params.append('scheduled', '0'); // Scheduled call
  // params.append('scheduled_datetime', scheduledDateTime);
  // params.append('timezone_id', timezoneId); 

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
    // Preprocess image if needed
    const processedBuffer = await preprocessImage(req.file.buffer);

    // Pass the processed image to Google Vision API
    let phoneNumbers = await googleVisionApi(processedBuffer);
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
  const { phoneNumbers, date, time, timezone } = req.body;

  // Combine date and time into a single string
  const dateTimeString = `${date} ${time}`;
  
  // Convert the combined date-time string to a moment object with the provided timezone
  const scheduledDateTime = moment.tz(dateTimeString, timezone);
  
  if (scheduledDateTime <= moment()) {
    return res.status(400).json({ message: 'Scheduled time must be in the future' });
  }

  // Adjust scheduledDateTime by subtracting 5 hours and 30 minutes
  scheduledDateTime.subtract(5, 'hours').subtract(30, 'minutes');

  // Generate the cron time based on the adjusted local time
  const cronTime = `${scheduledDateTime.minutes()} ${scheduledDateTime.hours()} ${scheduledDateTime.date()} ${scheduledDateTime.month() + 1} *`;

  console.log(`Cron time: ${cronTime}`);
  console.log(`Scheduled time: ${scheduledDateTime.toString()}`);

  const jobId = new ObjectId();

  try {
    await storeScheduledCalls(jobId, phoneNumbers, scheduledDateTime.toDate());
  } catch (error) {
    console.error('Error storing scheduled calls:', error.message);
    return res.status(500).json({ message: 'Failed to store scheduled calls' });
  }

  cron.schedule(cronTime, async () => {
    try {
      console.log(`Executing cron job at ${new Date().toISOString()}`);
      const result = await makeCall(phoneNumbers, scheduledDateTime.toDate());
      const statusMessage = result.success ? 'Success' : 'Failed';

      const scheduledCallsCollection = db.collection('scheduledCalls');
      await scheduledCallsCollection.updateOne(
        { jobId },
        { $set: { status: statusMessage, message: `Scheduled call at ${moment.tz(scheduledDateTime, timezone).format('LLLL')}: ${statusMessage}` } }
      );
      console.log(`Scheduled call at ${moment.tz(scheduledDateTime, timezone).format('LLLL')} for ${phoneNumbers.length} phone numbers: ${statusMessage}`);
    } catch (error) {
      console.error('Error executing cron job:', error.message);
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

// Fetch Bulk SMS balance
const fetchBulkSmsBalance = async () => {
  try {
    const response = await axios.post('https://www.bulksmsplans.com/api/check_balance', null, {
      params: {
        api_id: process.env.BULKSMS_API_ID,
        api_password: process.env.BULKSMS_API_PASSWORD
      }
    });

    console.log('Balance check response:', response.data);

    if (response.data && response.data.code === 200 && response.data.data && response.data.data.length > 0) {
      const balance = parseFloat(response.data.data[0].BalanceAmount);
      return balance;
    } else {
      throw new Error('Unable to retrieve balance');
    }
  } catch (error) {
    console.error('Error checking balance:', error.message);
    throw error;
  }
};

// Route to fetch and return Bulk SMS balance
app.get('/api/balance', async (req, res) => {
  try {
    const balance = await fetchBulkSmsBalance();
    res.json({ balance });
  } catch (error) {
    console.error('Failed to fetch balance:', error.message);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
