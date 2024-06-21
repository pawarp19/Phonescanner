const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');

const app = express();
const upload = multer();

app.use(cors());

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Routes
app.post('/upload', upload.single('image'), async (req, res) => {
  const apiKey = 'K88040098088957'; // Replace with your OCR.space API key

  try {
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    formData.append('apikey', apiKey);
    formData.append('filetype', req.file.mimetype.split('/')[1]); // Set file type

    console.log('Sending request to OCR API...');

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

// Endpoint for sending a voice note using POST
app.post('/call', async (req, res) => {
  const { phoneNumbers } = req.body;
  const apiId = 'APIUVRy5e4I131231'; // Replace with your BulkSMSPlans API ID
  const apiPassword = 'Kvg3mB4R'; // Replace with your BulkSMSPlans API Password
  const voiceType = '6'; // Replace with your voice type (if applicable)
  const voiceMediasId = '6009'; // Replace with your voice media ID
  const scheduled = '0'; // Replace with your scheduled time (if applicable)

  try {
    if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      throw new Error('Phone numbers array is missing or invalid');
    }

    const params = new URLSearchParams();
    params.append('api_id', apiId);
    params.append('api_password', apiPassword);
    params.append('number', phoneNumbers.join(',')); // Join array of phone numbers with comma
    params.append('voice_type', voiceType);
    params.append('voice_medias_id', voiceMediasId);
    params.append('scheduled', scheduled);

    const response = await axios.post('https://www.bulksmsplans.com/api/send_voice_note', params);

    console.log('Voice note sent:', response.data);

    // Check response status and data
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

// Server listening
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
