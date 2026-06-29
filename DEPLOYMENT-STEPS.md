# Deployment Steps

## 1. Create subdomain

Recommended:

```text
feedback.multidynamic.com.au
```

Create DNS:

```text
Type: CNAME or A record
Name: feedback
Value: server target
```

## 2. Install SSL

The app must use HTTPS.

## 3. Upload project

Upload this folder to your server.

## 4. Install Node dependencies

```bash
npm install
```

## 5. Create `.env`

```bash
cp .env.example .env
```

Update:

```text
APP_BASE_URL=https://feedback.multidynamic.com.au
SESSION_SECRET=long-random-value
SMTP_USER=admin@multidynamic.com.au
SMTP_PASS=your SMTP password
```

## 6. Start app

Testing:

```bash
npm start
```

Production with PM2:

```bash
npm install -g pm2
pm2 start server.js --name feedback-md
pm2 save
```

## 7. Nginx reverse proxy example

```nginx
server {
    server_name feedback.multidynamic.com.au;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 8. Test URLs

```text
https://feedback.multidynamic.com.au/health
https://feedback.multidynamic.com.au/saml/metadata
```

## 9. Configure Blink SSO

```text
Display name:
Feedback - MD

Entity ID:
https://feedback.multidynamic.com.au/saml/metadata

ACS:
https://feedback.multidynamic.com.au/sso/acs

Name ID Source:
Email
```

## 10. Create Blink Hub app

```text
Hub Item Type:
Single Sign-On

Name:
Feedback - MD

SSO Configuration:
Feedback - MD

Relay State:
https://feedback.multidynamic.com.au
```
