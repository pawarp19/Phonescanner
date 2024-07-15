document.getElementById('image').addEventListener('change', (e) => {
  const fileName = e.target.files[0].name;
  document.getElementById('file-name').textContent = fileName;
});

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('image');
  const file = fileInput.files[0];
  if (!file) {
    console.error('No file selected');
    return;
  }
  const canvas = document.createElement('canvas');
  const img = document.createElement('img');

  const reader = new FileReader();
  reader.onload = (event) => {
    img.src = event.target.result;

    img.onload = async () => {
      const pica = window.pica();
      const width = img.width * 2;
      const height = img.height * 2;

      canvas.width = width;
      canvas.height = height;

      await pica.resize(img, canvas, {
        unsharpAmount: 80,
        unsharpThreshold: 2,
      });

      const ctx = canvas.getContext('2d');
      ctx.filter = 'contrast(200%) grayscale(100%)';
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('image', blob, file.name);

        document.getElementById('loading-spinner').style.display = 'block';

        try {
          const response = await fetch('http://localhost:3000/upload', {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }

          const result = await response.json();
          const phoneNumbersList = document.getElementById('phone-numbers');
          phoneNumbersList.innerHTML = '';

          document.getElementById('loading-spinner').style.display = 'none';

          if (result.phoneNumbers && result.phoneNumbers.length > 0) {
            // Filter and deduplicate phone numbers
            const validPhoneNumbers = [...new Set(result.phoneNumbers.filter(validatePhoneNumber))];

            if (validPhoneNumbers.length > 0) {
              validPhoneNumbers.forEach(phoneNumber => {
                const listItem = document.createElement('li');
                listItem.textContent = phoneNumber;
                phoneNumbersList.appendChild(listItem);
              });
            } else {
              phoneNumbersList.innerHTML = '<li>No valid 10 or 12-digit phone numbers found</li>';
            }
          } else {
            phoneNumbersList.innerHTML = '<li>No phone numbers found</li>';
          }
        } catch (error) {
          console.error('Error:', error.message);
          document.getElementById('loading-spinner').style.display = 'none';
          phoneNumbersList.innerHTML = '<li>Error processing the image. Please try again.</li>';
        }
      }, 'image/jpeg', 0.9);
    };
  };
  reader.readAsDataURL(file);
});

function validatePhoneNumber(phoneNumber) {
  // Allow both 10-digit and 12-digit phone numbers
  const phoneNumberPattern = /^\d{10}$|^\d{12}$/;
  return phoneNumberPattern.test(phoneNumber);
}

document.getElementById('schedule-button').addEventListener('click', async () => {
  const date = document.getElementById('schedule-date').value;
  const time = document.getElementById('schedule-time').value;

  const phoneNumbers = Array.from(document.getElementById('phone-numbers').children).map(li => li.textContent);

  if (phoneNumbers.length === 0) {
    alert('No phone numbers to schedule');
    return;
  }

  try {
    const response = await fetch('http://localhost:3000/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phoneNumbers, date, time })
    });

    const result = await response.json();

    if (result.message === 'Call scheduled successfully') {
      alert('Calls scheduled successfully');
    } else {
      alert('Failed to schedule calls: ' + result.message);
    }
  } catch (error) {
    console.error('Error scheduling calls:', error.message);
    alert('Failed to schedule calls. Please try again.');
  }
});
