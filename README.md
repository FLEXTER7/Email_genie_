# Email Genie — CorrLinks ↔ SMS Bridge

Email Genie lets incarcerated people communicate with family over SMS by bridging CorrLinks email to phone text messages.

```
CorrLinks email  →  emailgenie.org bridge address  →  SMS to subscriber's phone
Subscriber's SMS reply  →  CorrLinks email address  →  inmate inbox
```

---

## Quick Start (local dev)

```bash
cp .env.example .env      # fill in your credentials
npm install
npm start                 # http://localhost:3000
```

---

## Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP port (default: 3000) |
| `ADMIN_SECRET` | **yes** | Secret token for admin panel — set to a long random string |
| `TWILIO_ACCOUNT_SID` | **yes** | From [Twilio console](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | **yes** | From Twilio console |
| `TWILIO_FROM_NUMBER` | **yes** | Your Twilio phone number (E.164, e.g. `+15550001234`) |
| `SMTP_HOST` | **yes** | SMTP host (e.g. `smtp.mailgun.org`) |
| `SMTP_PORT` | no | SMTP port (default: 587) |
| `SMTP_USER` | **yes** | SMTP username |
| `SMTP_PASS` | **yes** | SMTP password |
| `SMTP_FROM` | no | From address (defaults to `SMTP_USER`) |
| `DB_PATH` | no | SQLite database path (default: `./data/emailgenie.db`) |
| `MAILGUN_SIGNING_KEY` | **yes** | Mailgun HTTP webhook signing key — used to verify inbound-email signatures |
| `CORS_ORIGIN` | **yes** | Allowed CORS origin in production (e.g. `https://emailgenie.org`) or `*` |

---

## Production Deployment (Render)

### Option A — Blueprint (`render.yaml`, recommended)

1. Push this repo to GitHub.
2. In Render, create a new **Blueprint** and select this repository.
3. Render will read `render.yaml` and create the web service with:
   - Build command: `npm install`
   - Start command: `npm start`
   - `NODE_ENV=production`
4. Fill in the `sync: false` environment variables in Render before first deploy.
5. Verify the blueprint-created **Persistent Disk** is enabled (defaulted to 5GB in `render.yaml`) and keep `DB_PATH=/var/data/email-genie.db` for SQLite persistence.

### Option B — Manual Web Service setup

1. Push this repo to GitHub.
2. In Render, create a new **Web Service** from this repository.
3. Runtime: **Node**
4. Build command: `npm install`
5. Start command: `npm start`
6. Set `NODE_ENV=production`.
7. Add all environment variables from the table above.
8. Add a persistent disk and set `DB_PATH` to the mounted disk path (example: `/var/data/email-genie.db`).

> If you do not use a persistent disk, SQLite data is ephemeral and can be lost after restarts/redeploys.

---

## DNS Setup — `emailgenie.org`

Point your domain's MX records to **Mailgun**:

| Priority | Value |
|---|---|
| 10 | `mxa.mailgun.org` |
| 10 | `mxb.mailgun.org` |

> These records tell email servers to deliver all `@emailgenie.org` mail to Mailgun.

---

## Mailgun Setup (Inbound Email → SMS)

1. Log in to [Mailgun](https://app.mailgun.com).
2. Go to **Sending → Domains** → add `emailgenie.org`.
3. Follow Mailgun's DNS verification steps.
4. Go to **Receiving → Create Route**:
   - **Expression type**: Match Recipient
   - **Recipient**: `.*@emailgenie.org`
   - **Actions**: Forward → `https://your-deployed-url.com/webhooks/inbound-email`
5. Copy your Mailgun SMTP credentials into `.env` (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).

---

## Twilio Setup (SMS — two-way)

1. Log in to [Twilio](https://console.twilio.com).
2. Buy a phone number (**Phone Numbers → Buy a Number**).
3. Under the number's settings → **Messaging** → set:
   - "A Message Comes In" webhook: `POST https://your-deployed-url.com/webhooks/sms-reply`
4. Copy your **Account SID**, **Auth Token**, and phone number into `.env`.

---

## How the Forwarding Works

### CorrLinks email → subscriber's phone (SMS)

```
1. Inmate sends email to user-xxx@emailgenie.org
2. Mailgun receives it and HTTP POSTs to /webhooks/inbound-email
3. Server looks up which subscriber owns that bridge address
4. Server sends an SMS via Twilio to that subscriber's phone
```

### Subscriber's SMS reply → CorrLinks

```
1. Subscriber texts a reply to the Twilio number
2. Twilio HTTP POSTs to /webhooks/sms-reply
3. Server looks up which CorrLinks address belongs to that phone number
4. Server sends an email from noreply@emailgenie.org to the inmate's CorrLinks address
```

---

## Admin Panel

Visit `/admin.html` and enter your `ADMIN_SECRET` token.

- **Approve** a pending signup → generates a bridge email and emails it to the subscriber.
- **Delete** a pending or active user.

---

## Project Structure

```
server.js          ← Express app (entry point)
server/
  db.js            ← SQLite database layer
  sms.js           ← SMS sending (Twilio + carrier gateway fallback)
  email.js         ← Outbound email (SMTP)
public/
  index.html       ← Public signup page
  admin.html       ← Admin dashboard
.env.example       ← Environment variable template
data/              ← SQLite database (auto-created, git-ignored)
```
