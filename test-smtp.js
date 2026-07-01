require('dotenv').config();
const nodemailer = require('nodemailer');

(async () => {
  const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  const user = process.env.SMTP_USER || process.env.MAIL_USERNAME || process.env.MAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || process.env.MAIL_PASS;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || String(process.env.MAIL_ENCRYPTION || '').toLowerCase() === 'ssl';

  console.log('Testing SMTP:', host, port, user ? '[user set]' : '[no user]', 'secure=', secure);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    tls: String(process.env.MAIL_ENCRYPTION || '').toLowerCase() === 'tls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await transporter.verify();
    console.log('SMTP verify OK');

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || 'test@localhost',
      to: process.env.MAIL_TO || (user || 'recipient@example.com'),
      subject: 'SMTP test from feedback-md-full-app',
      text: 'This is a test message to verify SMTP settings.',
    });

    console.log('sendMail OK:', info.messageId || info.response);
    process.exit(0);
  } catch (e) {
    console.error('SMTP test failed:', e && (e.message || e));
    process.exit(1);
  }
})();
