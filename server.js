const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const app = express();
require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage() });

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

app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) {
    console.error('No file uploaded');
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const apiKey = process.env.OCR_API_KEY; // Replace with your OCR.space API key

  try {
    const formData = new FormData();
    formData.append('file', req.file.buffer, req.file.originalname);
    formData.append('apikey', apiKey);
    formData.append('filetype', req.file.mimetype.split('/')[1]); // Set file type

    const response = await axios.post('https://api.ocr.space/parse/image', formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    if (response.data && response.data.ParsedResults && response.data.ParsedResults[0]) {
      const parsedText = response.data.ParsedResults[0].ParsedText;
      const phoneNumbers = parsedText.match(/\+?\d+/g);
      console.log('Extracted Phone Numbers:', phoneNumbers);
      res.json({ phoneNumbers });
    } else {
      throw new Error('No valid response from OCR API');
    }
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
  const voiceMediasId = '6009';
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
