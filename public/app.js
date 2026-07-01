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

const LOGIN_ATTEMPT_KEY = 'feedback_md_login_attempted';

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
  if (!input) return;
  input.value = value && String(value).trim() ? String(value).trim() : fallback;
}

function normaliseBlinkUser(data) {
  const user = data.user || data.current_user || {};

  return {
    name:
      user.name ||
      user.display_name ||
      user.full_name ||
      '',

    office:
      user.office ||
      user.department_name ||
      user.department ||
      user.location_name ||
      '',

    email:
      user.email ||
      user.mail ||
      '',

    employeeId:
      user.employeeId ||
      user.employee_id ||
      user.employee_number ||
      '',

    jobTitle:
      user.jobTitle ||
      user.job_title ||
      ''
  };
}

function goToLoginOnce() {
  const alreadyTried = sessionStorage.getItem(LOGIN_ATTEMPT_KEY);

  if (alreadyTried === 'yes') {
    setUserField(staffName, '', 'Login session not found');
    setUserField(staffOffice, '', 'Login session not found');
    setUserField(staffEmail, '', 'Login session not found');

    showStatus(
      'warning',
      'Login was completed, but the session was not found. Please refresh once or open the form in a full browser tab.'
    );
    return;
  }

  sessionStorage.setItem(LOGIN_ATTEMPT_KEY, 'yes');

  if (window.self !== window.top) {
    window.top.location.href = 'https://feedback.multidynamic.com.au/login';
  } else {
    window.location.href = '/login';
  }
}

async function loadUser() {
  try {
    const response = await fetch('/api/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    });

    if (response.status === 401) {
      goToLoginOnce();
      return;
    }

    const data = await response.json();

    if (!data.authenticated) {
      goToLoginOnce();
      return;
    }

    const user = normaliseBlinkUser(data);

    setUserField(staffName, user.name, 'Not provided by Blink SSO');
    setUserField(staffOffice, user.office, 'Not provided by Blink SSO');
    setUserField(staffEmail, user.email, 'Not provided by Blink SSO');

    sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);

    if (!user.name || !user.office || !user.email) {
      showStatus(
        'warning',
        'Some staff details were not received from Blink SSO. Please check Blink attribute statements.'
      );
      return;
    }

    hideStatus();
  } catch (error) {
    console.error(error);

    setUserField(staffName, '', 'Could not load');
    setUserField(staffOffice, '', 'Could not load');
    setUserField(staffEmail, '', 'Could not load');

    showStatus('error', 'Could not load staff details. Please refresh the page or contact admin.');
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
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ feedback })
    });

    if (response.status === 401) {
      showStatus('warning', 'Your session has expired. Redirecting to Blink login...');
      goToLoginOnce();
      return;
    }

    const data = await response.json();

    if (!response.ok || !data.ok) {
      showStatus('error', data.message || 'Something went wrong. Please try again.');
      return;
    }

    feedbackInput.value = '';
    charCount.textContent = '0';
    sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);

    showStatus('success', data.message || 'Thank you. Your feedback has been submitted successfully.');
  } catch (error) {
    console.error(error);
    showStatus('error', 'Could not submit feedback. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

loadUser();