require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const passport = require('passport');
const { Strategy: SamlStrategy } = require('@node-saml/passport-saml');
const nodemailer = require('nodemailer');
const { createClient } = require('redis');
const connectRedis = require('connect-redis');
const RedisStore = connectRedis.RedisStore || connectRedis.default || connectRedis;

const app = express();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://feedback-md-full-app.onrender.com').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-session-secret';

const BLINK_LOGIN_URL = process.env.BLINK_LOGIN_URL;
const BLINK_ENTITY_ID =
  process.env.BLINK_ENTITY_ID ||
  'https://api.joinblink.com/saml/o-0193f1e9-5ec6-7b30-8497-f896dfbc85fb';

const BLINK_CERT_PATH = process.env.BLINK_CERT_PATH || './config/blink-idp-cert.pem';

const certAbsolutePath = path.resolve(__dirname, BLINK_CERT_PATH);
const blinkCertificate = fs.existsSync(certAbsolutePath)
  ? fs.readFileSync(certAbsolutePath, 'utf8')
  : '';

if (!BLINK_LOGIN_URL) {
  console.warn('WARNING: BLINK_LOGIN_URL is missing in .env');
}

if (!blinkCertificate) {
  console.warn('WARNING: Blink certificate file is missing or empty:', certAbsolutePath);
}

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let sessionStore;

if (process.env.REDIS_URL) {
  const redisClient = createClient({
    url: process.env.REDIS_URL
  });

  redisClient.on('error', (error) => {
    console.error('Redis session store error:', error);
  });

  redisClient.connect().catch((error) => {
    console.error('Redis connection failed:', error);
  });

  sessionStore = new RedisStore({
    client: redisClient,
    prefix: 'feedback-md-session:'
  });
} else {
  console.warn('REDIS_URL is not set. Using temporary MemoryStore for testing only.');
}

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'feedback_md_sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: APP_BASE_URL.startsWith('https://'),
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function firstValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function getAttribute(profile, possibleNames) {
  for (const name of possibleNames) {
    if (profile && profile[name]) return firstValue(profile[name]);

    if (profile && profile.attributes && profile.attributes[name]) {
      return firstValue(profile.attributes[name]);
    }
  }

  return '';
}

function mapSamlProfile(profile) {
  const email =
    getAttribute(profile, [
      'email',
      'Email',
      'mail',
      'user.email',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
    ]) ||
    profile.nameID ||
    '';

  const name = getAttribute(profile, [
    'name',
    'Name',
    'displayName',
    'full_name',
    'fullName',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
  ]);

  const office = getAttribute(profile, [
    'office',
    'Office',
    'location',
    'Location',
    'team',
    'Team',
    'department',
    'Department'
  ]);

  return {
    email,
    name,
    office,
    nameID: profile.nameID || '',
    sessionIndex: profile.sessionIndex || '',
    rawAttributes: profile.attributes || {}
  };
}
const samlStrategy = new SamlStrategy(
  {
    entryPoint: BLINK_LOGIN_URL,
    issuer: `${APP_BASE_URL}/saml/metadata`,
    callbackUrl: `${APP_BASE_URL}/sso/acs`,

    idpCert: blinkCertificate,

    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    acceptedClockSkewMs: 5000,
    disableRequestedAuthnContext: true,

    // Important for Blink Hub SSO / IdP-initiated SSO
    validateInResponseTo: 'never',

    // Start flexible for testing.
    // After it works, we can tighten security based on Blink’s signing method.
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false
  },
  (profile, done) => {
    const user = mapSamlProfile(profile);
    return done(null, user);
  }
);

passport.use('saml', samlStrategy);

function requireLogin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      authenticated: false,
      loginUrl: '/login'
    });
  }

  return res.redirect('/login');
}

app.use(
  express.static(path.join(__dirname, 'public'), {
    index: false
  })
);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'Feedback - MD',
    baseUrl: APP_BASE_URL
  });
});

app.get('/debug-config', (req, res) => {
  res.json({
    appBaseUrl: APP_BASE_URL,
    blinkLoginUrlSet: Boolean(BLINK_LOGIN_URL),
    blinkEntityId: BLINK_ENTITY_ID,
    blinkCertificateLoaded: Boolean(blinkCertificate),
    blinkCertPath: BLINK_CERT_PATH,
    metadataUrl: `${APP_BASE_URL}/saml/metadata`,
    acsUrl: `${APP_BASE_URL}/sso/acs`
  });
});

app.get('/saml/metadata', (req, res) => {
  try {
    const metadata = samlStrategy.generateServiceProviderMetadata(null, null);
    res.type('application/xml').send(metadata);
  } catch (error) {
    res.status(500).type('text/plain').send(`Could not generate metadata: ${error.message}`);
  }
});

app.get('/login', (req, res, next) => {
  if (!BLINK_LOGIN_URL) {
    return res.status(500).send('Missing BLINK_LOGIN_URL in Render environment variables.');
  }

  if (!blinkCertificate) {
    return res
      .status(500)
      .send('Missing Blink certificate. Check BLINK_CERT_PATH and config/blink-idp-cert.pem.');
  }

  return passport.authenticate('saml', {
    failureRedirect: '/login-failed'
  })(req, res, next);
});

app.post('/sso/acs', (req, res, next) => {
  passport.authenticate('saml', (error, user, info) => {
    if (error) {
      console.error('SAML ACS ERROR:', error);
      console.error('SAML ACS INFO:', info);

      return res.status(500).send(`
        <h2>SAML ACS Error</h2>
        <p>The app received the SAML response from Blink but could not validate it.</p>
        <pre>${String(error.stack || error.message || error)}</pre>
      `);
    }

    if (!user) {
      console.error('SAML ACS NO USER:', info);

      return res.status(401).send(`
        <h2>SAML Login Failed</h2>
        <p>No user profile was received from Blink.</p>
        <pre>${JSON.stringify(info || {}, null, 2)}</pre>
      `);
    }

    req.logIn(user, (loginError) => {
      if (loginError) {
        console.error('SAML SESSION LOGIN ERROR:', loginError);

        return res.status(500).send(`
          <h2>SAML Session Error</h2>
          <pre>${String(loginError.stack || loginError.message || loginError)}</pre>
        `);
      }

      return res.redirect('/');
    });
  })(req, res, next);
});

app.get('/login-failed', (req, res) => {
  res.status(401).sendFile(path.join(__dirname, 'public', 'login-failed.html'));
});

app.get('/api/me', requireLogin, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      name: req.user.name || '',
      office: req.user.office || '',
      email: req.user.email || ''
    },
    missing: {
      name: !req.user.name,
      office: !req.user.office,
      email: !req.user.email
    }
  });
});

app.post('/api/feedback', requireLogin, async (req, res) => {
  const user = req.user || {};
  const feedback = String(req.body.feedback || '').trim();

  if (!feedback) {
    return res.status(400).json({
      ok: false,
      message: 'Please enter feedback before submitting.'
    });
  }

  const submittedAt = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney'
  });

  const submission = {
    submittedAt,
    name: user.name || '',
    office: user.office || '',
    email: user.email || '',
    feedback
  };

  const dataDir = path.resolve(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  fs.appendFileSync(
    path.join(dataDir, 'feedback-submissions.jsonl'),
    JSON.stringify(submission) + '\n',
    'utf8'
  );

  const subject = 'New Staff Feedback Submitted - Feedback MD';

  const body = [
    'A new staff feedback response has been submitted.',
    '',
    `Name: ${submission.name || 'Not provided by Blink SSO'}`,
    `Office: ${submission.office || 'Not provided by Blink SSO'}`,
    `Email: ${submission.email || 'Not provided by Blink SSO'}`,
    '',
    'Feedback:',
    submission.feedback,
    '',
    `Submitted Date/Time: ${submittedAt}`
  ].join('\n');

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS
            }
          : undefined
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'Feedback MD <admin@multidynamic.com.au>',
      to: process.env.MAIL_TO || 'admin@multidynamic.com.au',
      replyTo: submission.email || undefined,
      subject,
      text: body
    });

    return res.json({
      ok: true,
      message: 'Thank you. Your feedback has been submitted successfully.'
    });
  } catch (error) {
    console.error('Email sending failed:', error);

    return res.status(500).json({
      ok: false,
      message:
        'Feedback was saved, but email sending failed. Please ask the developer to check SMTP settings.'
    });
  }
});

app.get('/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);

    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

app.get('*', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Feedback - MD app running on port ${PORT}`);
  console.log(`App base URL: ${APP_BASE_URL}`);
  console.log(`SP Metadata URL: ${APP_BASE_URL}/saml/metadata`);
  console.log(`ACS URL: ${APP_BASE_URL}/sso/acs`);
});
