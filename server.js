const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const fs = require("fs");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const passport = require("passport");
const { Strategy: SamlStrategy } = require("@node-saml/passport-saml");
const nodemailer = require("nodemailer");
const { createClient } = require("redis");
const connectRedis = require("connect-redis");

const RedisStore =
  connectRedis.RedisStore || connectRedis.default || connectRedis;

const app = express();

const emailTemplatesDir = path.resolve(__dirname, "emails");
const emailTemplates = {
  admin: fs.readFileSync(path.join(emailTemplatesDir, "admin.html"), "utf8"),
  user: fs.readFileSync(path.join(emailTemplatesDir, "user.html"), "utf8"),
};

function renderTemplate(template, values) {
  return String(template).replace(/{{\s*([\w]+)\s*}}/g, (_, key) => {
    return String(values[key] ?? "");
  });
}

const APP_BASE_URL = (
  process.env.APP_BASE_URL || "https://feedback.multidynamic.com.au"
).replace(/\/$/, "");

const PORT = Number(process.env.PORT || 3000);

const SESSION_SECRET =
  process.env.SESSION_SECRET || "replace-this-session-secret";

const BLINK_LOGIN_URL = process.env.BLINK_LOGIN_URL;

const BLINK_ENTITY_ID =
  process.env.BLINK_ENTITY_ID ||
  "https://api.joinblink.com/saml/o-0193f1e9-5ec6-7b30-8497-f896dfbc85fb";

const BLINK_CERT_PATH =
  process.env.BLINK_CERT_PATH || "./config/blink-idp-cert.pem";

const certAbsolutePath = path.resolve(__dirname, BLINK_CERT_PATH);

const blinkCertificate = fs.existsSync(certAbsolutePath)
  ? fs.readFileSync(certAbsolutePath, "utf8")
  : "";

if (!BLINK_LOGIN_URL) {
  console.warn("WARNING: BLINK_LOGIN_URL is missing in .env");
}

if (!blinkCertificate) {
  console.warn("WARNING: Blink certificate file is missing or empty:", certAbsolutePath);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
  }),
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let sessionStore;

if (process.env.REDIS_URL) {
  const redisClient = createClient({
    url: process.env.REDIS_URL,
  });

  redisClient.on("error", (error) => {
    console.error("Redis session store error:", error.message || error);
  });

  redisClient.connect().catch((error) => {
    console.error("Redis connection failed:", error.message || error);
  });

  sessionStore = new RedisStore({
    client: redisClient,
    prefix: "feedback-md-session:",
  });
} else {
  console.warn("REDIS_URL is not set. Using temporary MemoryStore for testing only.");
}

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "feedback_md_sid",
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      partitioned: true,
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

function firstValue(value) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

function getAttribute(profile, possibleNames) {
  for (const name of possibleNames) {
    if (profile && profile[name]) {
      return firstValue(profile[name]);
    }

    if (profile && profile.attributes && profile.attributes[name]) {
      return firstValue(profile.attributes[name]);
    }
  }

  return "";
}

function mapSamlProfile(profile) {
  const email =
    getAttribute(profile, ["email"]) ||
    profile.nameID ||
    "";

  const name =
    getAttribute(profile, ["display_name"]) ||
    "";

  const office =
    getAttribute(profile, ["department_name"]) ||
    "";

  const employeeId =
    getAttribute(profile, ["employee_id"]) ||
    "";

  const jobTitle =
    getAttribute(profile, ["job_title"]) ||
    "";

  return {
    email,
    name,
    office,
    employeeId,
    jobTitle,
    nameID: profile.nameID || "",
    sessionIndex: profile.sessionIndex || "",
    rawAttributes: profile.attributes || {},
  };
}

const samlStrategy = new SamlStrategy(
  {
    entryPoint: BLINK_LOGIN_URL,
    issuer: `${APP_BASE_URL}/saml/metadata`,
    callbackUrl: `${APP_BASE_URL}/sso/acs`,
    idpCert: blinkCertificate,

    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    acceptedClockSkewMs: 5000,
    disableRequestedAuthnContext: true,
    validateInResponseTo: "never",

    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
  },
  (profile, done) => {
    const user = mapSamlProfile(profile);
    return done(null, user);
  },
);

passport.use("saml", samlStrategy);

function getCurrentUser(req) {
  return req.user || (req.session && req.session.user) || null;
}

function requireLogin(req, res, next) {
  const user = getCurrentUser(req);

  if (user) {
    req.user = user;
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({
      authenticated: false,
      loginUrl: "/login",
    });
  }

  return res.redirect("/login");
}

app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
  }),
);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Feedback - MD",
    baseUrl: APP_BASE_URL,
  });
});

app.get("/debug-config", (req, res) => {
  res.json({
    appBaseUrl: APP_BASE_URL,
    blinkLoginUrlSet: Boolean(BLINK_LOGIN_URL),
    blinkEntityId: BLINK_ENTITY_ID,
    blinkCertificateLoaded: Boolean(blinkCertificate),
    blinkCertPath: BLINK_CERT_PATH,
    metadataUrl: `${APP_BASE_URL}/saml/metadata`,
    acsUrl: `${APP_BASE_URL}/sso/acs`,
  });
});

app.get("/saml/metadata", (req, res) => {
  try {
    const metadata = samlStrategy.generateServiceProviderMetadata(null, null);
    return res.type("application/xml").send(metadata);
  } catch (error) {
    return res
      .status(500)
      .type("text/plain")
      .send(`Could not generate metadata: ${error.message}`);
  }
});

app.get("/login", (req, res, next) => {
  const user = getCurrentUser(req);

  if (user) {
    return res.redirect("/");
  }

  if (!BLINK_LOGIN_URL) {
    return res
      .status(500)
      .send("Missing BLINK_LOGIN_URL in environment variables.");
  }

  if (!blinkCertificate) {
    return res
      .status(500)
      .send("Missing Blink certificate. Check BLINK_CERT_PATH and config/blink-idp-cert.pem.");
  }

  return passport.authenticate("saml", {
    failureRedirect: "/login-failed",
  })(req, res, next);
});

app.post("/sso/acs", (req, res, next) => {
  passport.authenticate("saml", (error, user, info) => {
    if (error) {
      console.error("SAML ACS ERROR:", error);
      console.error("SAML ACS INFO:", info);

      return res.status(500).send(`
        <h2>SAML ACS Error</h2>
        <p>The app received the SAML response from Blink but could not validate it.</p>
        <pre>${String(error.stack || error.message || error)}</pre>
      `);
    }

    if (!user) {
      console.error("SAML ACS NO USER:", info);

      return res.status(401).send(`
        <h2>SAML Login Failed</h2>
        <p>No user profile was received from Blink.</p>
        <pre>${JSON.stringify(info || {}, null, 2)}</pre>
      `);
    }

    req.logIn(user, (loginError) => {
      if (loginError) {
        console.error("SAML SESSION LOGIN ERROR:", loginError);

        return res.status(500).send(`
          <h2>SAML Session Error</h2>
          <pre>${String(loginError.stack || loginError.message || loginError)}</pre>
        `);
      }

      req.session.user = user;
      req.session.ssoDone = true;

      req.session.save((saveError) => {
        if (saveError) {
          console.error("SESSION SAVE ERROR:", saveError);
          return res.status(500).send("Session save error after SAML login.");
        }

        return res.redirect(303, "/");
      });
    });
  })(req, res, next);
});

app.get("/login-failed", (req, res) => {
  res.status(401).sendFile(path.join(__dirname, "public", "login-failed.html"));
});

app.get("/api/me", requireLogin, (req, res) => {
  const user = getCurrentUser(req) || {};

  res.json({
    authenticated: true,
    user: {
      name: user.name || "",
      office: user.office || "",
      email: user.email || "",
      employeeId: user.employeeId || "",
      jobTitle: user.jobTitle || "",
    },
    missing: {
      name: !user.name,
      office: !user.office,
      email: !user.email,
      employeeId: !user.employeeId,
      jobTitle: !user.jobTitle,
    },
  });
});

app.post("/api/feedback", requireLogin, async (req, res) => {
  const user = getCurrentUser(req) || {};
  const feedback = String(req.body.feedback || "").trim();

  if (!feedback) {
    return res.status(400).json({
      ok: false,
      message: "Please enter feedback before submitting.",
    });
  }

  const submittedAt = new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
  });

  const postedName = String(req.body && req.body.name ? req.body.name : '').trim();

  const submission = {
    submittedAt,
    name: postedName || user.name || "",
    office: user.office || "",
    email: user.email || "",
    employeeId: user.employeeId || "",
    jobTitle: user.jobTitle || "",
    feedback,
  };

  const dataDir = path.resolve(__dirname, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  fs.appendFileSync(
    path.join(dataDir, "feedback-submissions.jsonl"),
    JSON.stringify(submission) + "\n",
    "utf8",
  );

  const subject = "New Staff Feedback Submitted - Feedback MD";

  const body = [
    "A new staff feedback response has been submitted.",
    "",
    `Name: ${submission.name || "Not provided by Blink"}`,
    `Office: ${submission.office || "Not provided by Blink"}`,
    `Email: ${submission.email || "Not provided by Blink"}`,
    `Employee ID: ${submission.employeeId || "Not provided by Blink"}`,
    `Job Title: ${submission.jobTitle || "Not provided by Blink"}`,
    "",
    "Feedback:",
    submission.feedback,
    "",
    `Submitted Date/Time: ${submittedAt}`,
  ].join("\n");

  // Basic HTML escaping to avoid injection in emails
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderTemplate(template, values) {
    return String(template).replace(/{{\s*([\w]+)\s*}}/g, (_, key) => {
      return escapeHtml(values[key] ?? '');
    });
  }

  const logoUrl = process.env.LOGO_URL || 'https://multidynamic.com.au/assets/images/logo/logo.png';
  const templatesDir = path.resolve(__dirname, 'emails');

  const adminTemplate = fs.readFileSync(path.join(templatesDir, 'admin.html'), 'utf8');
  const userTemplate = fs.readFileSync(path.join(templatesDir, 'user.html'), 'utf8');

  const templateData = {
    logoUrl,
    name: submission.name || 'there',
    office: submission.office || 'Not provided',
    email: submission.email || 'Not provided',
    employeeId: submission.employeeId || 'Not provided',
    jobTitle: submission.jobTitle || 'Not provided',
    submittedAt,
    feedback: submission.feedback || '',
  };

  const htmlAdmin = renderTemplate(adminTemplate, templateData);
  const htmlUser = renderTemplate(userTemplate, templateData);

  try {
    // prefer explicit SMTP_* vars, fall back to MAIL_* vars commonly used in .env
    const mailHost = process.env.SMTP_HOST || process.env.MAIL_HOST || process.env.MAILER_HOST || '';
    const mailPort = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || process.env.MAILER_PORT || 587);
    const mailUser = process.env.SMTP_USER || process.env.MAIL_USERNAME || process.env.MAIL_USER || undefined;
    const mailPass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || process.env.MAIL_PASS || undefined;

    // decide whether to use secure connection (SSL). Prefer explicit SMTP_SECURE; otherwise treat MAIL_ENCRYPTION === 'ssl' as secure.
    let secure = false;
    if (typeof process.env.SMTP_SECURE !== 'undefined') {
      secure = String(process.env.SMTP_SECURE).toLowerCase() === 'true';
    } else if (process.env.MAIL_ENCRYPTION) {
      secure = String(process.env.MAIL_ENCRYPTION).toLowerCase() === 'ssl';
    }

    if (!mailHost) {
      throw new Error('SMTP host is not configured. Set SMTP_HOST or MAIL_HOST in .env.');
    }

    const smtpConfig = {
      host: mailHost,
      port: mailPort,
      user: Boolean(mailUser),
      secure,
      useTls: String(process.env.MAIL_ENCRYPTION || '').toLowerCase() === 'tls',
    };

    if (mailHost.includes('mailtrap.io')) {
      console.warn('WARNING: Mailtrap SMTP is configured. This captures email in Mailtrap and does not deliver to real inboxes.');
    }

    const transporter = nodemailer.createTransport({
      host: mailHost,
      port: mailPort,
      secure,
      auth: mailUser && mailPass ? { user: mailUser, pass: mailPass } : undefined,
      tls:
        String(process.env.MAIL_ENCRYPTION || '').toLowerCase() === 'tls'
          ? { rejectUnauthorized: false }
          : undefined,
    });

    // verify SMTP connection before sending
    try {
      await transporter.verify();
      console.log('SMTP connection verified');
    } catch (verifyErr) {
      console.error('SMTP verify failed:', verifyErr && verifyErr.message ? verifyErr.message : verifyErr);
      throw new Error(`SMTP verify failed: ${verifyErr && verifyErr.message ? verifyErr.message : String(verifyErr)}`);
    }

    // send admin notification (HTML + fallback text)
    let adminResult;
    const adminMailOptions = {
      from: process.env.MAIL_FROM || "Feedback MD <noreply@multidynamic.com.au>",
      to: process.env.MAIL_TO || "admin@multidynamic.com.au",
      subject,
      text: body,
      html: htmlAdmin,
    };

    try {
      adminResult = await transporter.sendMail(adminMailOptions);
      console.log('Admin email sent', {
        from: adminMailOptions.from,
        to: adminMailOptions.to,
        subject: adminMailOptions.subject,
        accepted: adminResult.accepted,
        rejected: adminResult.rejected,
      });
    } catch (adminErr) {
      console.error('Admin email failed', {
        mailOptions: adminMailOptions,
        error: adminErr && (adminErr.message || adminErr),
      });
      // Admin notification is critical — return 500 so operator can fix SMTP/settings
      return res.status(500).json({
        ok: false,
        message: 'Feedback saved but admin notification failed. Check SMTP settings.',
        error: String(adminErr && (adminErr.message || adminErr)),
      });
    }

    // send thank-you email to submitter (if an email is available)
    let userEmailSent = false;
    let userEmailError = null;

    if (submission.email) {
      const userMailOptions = {
        from: process.env.MAIL_FROM || "Feedback MD <noreply@multidynamic.com.au>",
        to: submission.email,
        subject: 'Thanks for your feedback - Multi Dynamic',
        text: `Hi ${submission.name || ''}\n\nThank you for your feedback.\n\nSubmitted:\n${submission.feedback}\n\nRegards,\nMulti Dynamic`,
        html: htmlUser,
      };

      try {
        const userResult = await transporter.sendMail(userMailOptions);
        userEmailSent = true;
        console.log('User email sent', {
          from: userMailOptions.from,
          to: userMailOptions.to,
          subject: userMailOptions.subject,
          accepted: userResult.accepted,
          rejected: userResult.rejected,
        });
      } catch (userErr) {
        userEmailSent = false;
        userEmailError = String(userErr && (userErr.message || userErr));
        console.error('User email failed', {
          from: userMailOptions.from,
          to: userMailOptions.to,
          subject: userMailOptions.subject,
          error: userEmailError,
        });
        // Do not throw — user email failure should not prevent a successful submission
      }
    }

    // Return successful submission response; include whether user email was sent
    return res.json({
      ok: true,
      message: 'Thank you. Your feedback has been submitted successfully.',
      userEmailSent,
      userEmailError,
    });
  } catch (error) {
    console.error("Email sending failed:", error);

    return res.status(500).json({
      ok: false,
      message:
        "Feedback was saved, but email sending failed. Please ask the developer to check SMTP settings.",
    });
  }
});

app.get("/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) {
      return next(error);
    }

    req.session.destroy(() => {
      res.clearCookie("feedback_md_sid", {
        httpOnly: true,
        sameSite: "none",
        secure: true,
        partitioned: true,
      });

      return res.redirect("/login");
    });
  });
});

app.get("*", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Feedback app running on http://127.0.0.1:${PORT}`);
});