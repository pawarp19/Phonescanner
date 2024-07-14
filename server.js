const express = require('express');
const multer = require('multer');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const path = require('path');
const cors = require('cors');
const axios=require('axios');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const visionClient = new ImageAnnotatorClient({
  keyFilename: path.join(__dirname, 'googlecloudkey.json') // Ensure this path is correct
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const extractPhoneNumbers = (text) => {
  const allNumbers = text.match(/\d+/g) || [];
  // Filter to get only 10 or 12 digit numbers
  return allNumbers.filter(number => number.length === 10 || number.length === 12);
};

const googleVisionApi = async (buffer) => {
  try {
    const [result] = await visionClient.textDetection({ image: { content: buffer } });
    const detections = result.textAnnotations;
    if (detections.length > 0) {
      const parsedText = detections[0].description;
      console.log('Extracted Text:', parsedText); // Log the extracted text for debugging
      return extractPhoneNumbers(parsedText);
    } else {
      throw new Error('No text detected');
    }
  } catch (error) {
    console.error('Error during text detection:', error.message);
    throw error;
  }
};

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

app.post('/call', async (req, res) => {
  const { phoneNumbers } = req.body;
  const apiId = process.env.BULKSMS_API_ID;
  const apiPassword = process.env.BULKSMS_API_PASSWORD;
  const voiceType = '6';
  const voiceMediasId = '6007';
  const scheduled = '0';

  try {
    if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      throw new Error('Phone numbers array is missing or invalid');
    }

    const params = new URLSearchParams();
    params.append('api_id', apiId);
    params.append('api_password', apiPassword);
    params.append('number', phoneNumbers.join(','));
    params.append('voice_type', voiceType);
    params.append('voice_medias_id', voiceMediasId);
    params.append('scheduled', scheduled);
    params.append('sender', 'HELLOVC');

    const response = await axios.post('https://www.bulksmsplans.com/api/send_voice_note', params);

    console.log('Voice note sent:', response.data);

    if (response.data && response.data.code === 200) {
      console.log('Voice note sent successfully:', response.data);
      res.json(response.data);
    } else {
      console.error('Error in API response:', response.data);
      res.status(500).json({ message: 'Error in API response', data: response.data });
    }
  } catch (error) {
    console.error('Error sending voice note:', error.message);
    res.status(500).json({ message: 'Error sending voice note', error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});