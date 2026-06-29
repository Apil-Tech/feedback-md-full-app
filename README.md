# Feedback - MD Full App

This project includes both:

1. Backend SAML SSO app
2. Frontend feedback form UI

## Purpose

Staff open Feedback - MD from Blink. Blink SSO passes staff details to the app.

The frontend shows:

- Name from SSO
- Office from SSO
- Email from SSO
- Feedback text area

Staff only need to type their feedback.

After submit, the app emails:

```text
admin@multidynamic.com.au
```

## Recommended URL

```text
https://feedback.multidynamic.com.au
```

## Required URLs

```text
Main app:
https://feedback.multidynamic.com.au

Metadata / Entity ID:
https://feedback.multidynamic.com.au/saml/metadata

ACS:
https://feedback.multidynamic.com.au/sso/acs

Login:
https://feedback.multidynamic.com.au/login

Health check:
https://feedback.multidynamic.com.au/health
```

## Install

```bash
npm install
```

## Environment setup

Copy:

```bash
cp .env.example .env
```

Then update:

```text
APP_BASE_URL
SESSION_SECRET
SMTP_USER
SMTP_PASS
MAIL_FROM
MAIL_TO
```

## Start

```bash
npm start
```

## Blink SSO setup

In Blink, configure:

```text
Display name:
Feedback - MD

Entity ID:
https://feedback.multidynamic.com.au/saml/metadata

Single sign-on URL / ACS:
https://feedback.multidynamic.com.au/sso/acs

Name ID Source:
Email
```

## Blink attribute statements

Add:

```text
email  = Email
name   = Full Name / Display Name
office = Office / Location / Team
```

Office must already exist in Blink user profiles.

## Blink Hub item

Create as:

```text
Type:
Single Sign-On

Name:
Feedback - MD

SSO Configuration:
Feedback - MD

Relay State:
https://feedback.multidynamic.com.au
```

## Included frontend files

```text
public/index.html
public/styles.css
public/app.js
public/login-failed.html
```

## Included Blink files

The uploaded Blink metadata and certificate are included:

```text
config/blink-metadata.xml
config/blink-idp-cert.pem
```
