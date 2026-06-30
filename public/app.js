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

async function loadUser() {
  try {
    const response = await fetch('/api/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await response.json();

    if (!data.authenticated) {
      window.location.href = data.loginUrl || '/login';
      return;
    }

    const user = data.user || {};

    setUserField(staffName, user.name, 'Not provided by Blink SSO');
    setUserField(staffOffice, user.office, 'Not provided by Blink SSO');
    setUserField(staffEmail, user.email, 'Not provided by Blink SSO');

    if (data.missing && (data.missing.name || data.missing.office || data.missing.email)) {
      showStatus(
        'warning',
        'Some staff details were not received from Blink SSO. Please check Blink attribute statements.'
      );
    }
  } catch (error) {
    console.error(error);
    showStatus('error', 'Could not load staff details from SSO. Please refresh the page or contact admin.');
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
        Accept: 'application/json'
      },
      body: JSON.stringify({ feedback })
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

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