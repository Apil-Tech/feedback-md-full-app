const form = document.getElementById('feedbackForm');
const feedbackInput = document.getElementById('feedback');
const charCount = document.getElementById('charCount');
const statusMessage = document.getElementById('statusMessage');
const submitButton = document.getElementById('submitButton');
const buttonText = document.getElementById('buttonText');
const buttonLoader = document.getElementById('buttonLoader');

const staffName = document.getElementById('staffName');
const staffOffice = document.getElementById('staffOffice');
const staffEmail = document.getElementById('staffEmail');

const urlParams = new URLSearchParams(window.location.search);

const blinkUser = {
  name: urlParams.get('name') || '',
  office: urlParams.get('office') || '',
  email: urlParams.get('email') || '',
  employeeId: urlParams.get('employee_id') || ''
};

function showStatus(type, message) {
  statusMessage.className = `status ${type}`;
  statusMessage.textContent = message;
  statusMessage.classList.remove('hidden');
}

function hideStatus() {
  statusMessage.className = 'status hidden';
  statusMessage.textContent = '';
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  buttonText.textContent = isLoading ? 'Submitting...' : 'Submit Feedback';
  buttonLoader.classList.toggle('hidden', !isLoading);
}

function setUserField(input, value, fallback) {
  input.value = value && value.trim() ? value : fallback;
}

function loadUser() {
  setUserField(staffName, blinkUser.name, 'Not provided by Blink');
  setUserField(staffOffice, blinkUser.office, 'Not provided by Blink');
  setUserField(staffEmail, blinkUser.email, 'Not provided by Blink');

  if (!blinkUser.name || !blinkUser.office || !blinkUser.email) {
    showStatus(
      'warning',
      'Some staff details were not received from Blink. Please check the Micro-App URL parameters.'
    );
  }
}

feedbackInput.addEventListener('input', () => {
  charCount.textContent = feedbackInput.value.length;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideStatus();

  const feedback = feedbackInput.value.trim();

  if (!feedback) {
    showStatus('error', 'Please enter feedback before submitting.');
    feedbackInput.focus();
    return;
  }

  setLoading(true);

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        name: blinkUser.name,
        office: blinkUser.office,
        email: blinkUser.email,
        employeeId: blinkUser.employeeId,
        feedback
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      showStatus('error', data.message || 'Something went wrong. Please try again.');
      return;
    }

    feedbackInput.value = '';
    charCount.textContent = '0';
    showStatus('success', data.message || 'Thank you. Your feedback has been submitted successfully.');
  } catch (error) {
    console.error(error);
    showStatus('error', 'Could not submit feedback. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

loadUser();