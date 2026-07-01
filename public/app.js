const form = document.getElementById('feedbackForm');
const feedbackInput = document.getElementById('feedback');
const charCount = document.getElementById('charCount');
const statusMessage = document.getElementById('statusMessage');
const submitButton = document.getElementById('submitButton');
const buttonText = document.getElementById('buttonText');
const buttonLoader = document.getElementById('buttonLoader');

const displayInfo = document.getElementById('displayInfo');
const staffNameHidden = document.getElementById('staffNameHidden');
const staffOfficeHidden = document.getElementById('staffOfficeHidden');
const staffEmailHidden = document.getElementById('staffEmailHidden');
const greeting = document.getElementById('greeting');

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

function setDisplayField(displayEl, hiddenEl, value, fallback) {
  const text = value && String(value).trim() ? String(value).trim() : fallback;
  if (displayEl) displayEl.textContent = text;
  if (hiddenEl) hiddenEl.value = value && String(value).trim() ? String(value).trim() : '';
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
    if (displayInfo) displayInfo.textContent = 'Login session not found';
    if (staffNameHidden) staffNameHidden.value = '';
    if (staffOfficeHidden) staffOfficeHidden.value = '';
    if (staffEmailHidden) staffEmailHidden.value = '';

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

    // compose a single sentence with name, department and email
    const infoParts = [];
    if (user.name) infoParts.push(user.name);
    if (user.office) infoParts.push(`from ${user.office}`);
    if (user.email) infoParts.push(`(${user.email})`);
    const infoSentence = infoParts.length ? infoParts.join(' ') : 'Not provided';

    if (displayInfo) displayInfo.textContent = infoSentence;
    if (staffNameHidden) staffNameHidden.value = user.name || '';
    if (staffOfficeHidden) staffOfficeHidden.value = user.office || '';
    if (staffEmailHidden) staffEmailHidden.value = user.email || '';

    // show greeting using the staff name (from hidden field)
    if (greeting) {
      greeting.textContent = `Hi ${user.name || ''}`.trim();
    }

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

    if (displayInfo) displayInfo.textContent = 'Could not load';
    if (staffNameHidden) staffNameHidden.value = '';
    if (staffOfficeHidden) staffOfficeHidden.value = '';
    if (staffEmailHidden) staffEmailHidden.value = '';

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
      body: JSON.stringify({ feedback, name: staffNameHidden ? staffNameHidden.value.trim() : (displayInfo ? displayInfo.textContent : '') })
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

    // clear the feedback field
    feedbackInput.value = '';
    charCount.textContent = '0';
    sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);

    // show a friendly themed thank-you message using the staff name
    const formBox = document.querySelector('.form-box');

    function escapeHtml(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const name = staffNameHidden && staffNameHidden.value ? staffNameHidden.value : (displayInfo ? displayInfo.textContent : '');

    formBox.innerHTML = `
      <h1>Feedback</h1>
      <p class="intro">Please share your feedback. Just type your feedback and submit.</p>
      <div id="statusMessage" class="status success">${escapeHtml(data.message || 'Thank you. Your feedback has been submitted successfully.')}</div>
      <section style="padding:18px;text-align:center;">
        <h2 style="color:#02519b;margin-top:8px;">Hi ${escapeHtml(name) || 'there'},</h2>
        <p style="color:#667085;">Thanks for your feedback.</p>
        <p style="margin-top:18px;"><a href="/" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#f36421;color:#fff;text-decoration:none;font-weight:700;">Submit another response</a></p>
      </section>
    `;
  } catch (error) {
    console.error(error);
    showStatus('error', 'Could not submit feedback. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

loadUser();