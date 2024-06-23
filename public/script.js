document.getElementById('image').addEventListener('change', (e) => {
    const fileName = e.target.files[0].name;
    document.getElementById('file-name').textContent = fileName;
  });

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById('image');
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('image', file);

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

      if (result.phoneNumbers && result.phoneNumbers.length > 0) {
        result.phoneNumbers.forEach(phoneNumber => {
          const listItem = document.createElement('li');
          listItem.textContent = phoneNumber;

          const callButton = document.createElement('button');
          callButton.innerHTML = '<i class="fas fa-phone-alt"></i> Call';
          callButton.addEventListener('click', () => makeCall(phoneNumber));

          listItem.appendChild(callButton);
          phoneNumbersList.appendChild(listItem);
        });
      } else {
        phoneNumbersList.innerHTML = '<li>No phone numbers found</li>';
      }
    } catch (error) {
      console.error('Error:', error.message);
    }
  });

  async function makeCall(phoneNumber) {
    const data = { phoneNumbers: [phoneNumber] };
    try {
      const response = await fetch('http://localhost:3000/call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json();
      alert(`Call status: ${result.message}`);
    } catch (error) {
      console.error('Error:', error.message);
    }
  }