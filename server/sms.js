/**
 * SMS helper — sends a text message via Twilio SMS.
 * Falls back to carrier email-to-SMS gateway when Twilio credentials
 * are not configured (useful during local development).
 */

const twilio = require('twilio');
const nodemailer = require('nodemailer');
const { getSmsEmail } = require('./db');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER; // e.g. +15550001234

// Optional SMTP fallback (carrier gateway)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

/**
 * Send an SMS to a subscriber.
 *
 * @param {string} toPhone  - subscriber's phone number (digits only)
 * @param {string} carrier  - carrier key from CARRIER_GATEWAYS
 * @param {string} body     - message text (max 160 chars recommended)
 */
async function sendSms(toPhone, carrier, body) {
    const phone = toPhone.replace(/\D/g, '');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
        // ── Twilio path ──────────────────────────────────────────────────
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const msg = await client.messages.create({
            body,
            from: TWILIO_FROM_NUMBER,
            to:   `+1${phone}`  // assumes US numbers; adjust prefix if needed
        });
        console.log(`[SMS] Twilio sent to +1${phone} — SID: ${msg.sid}`);
        return { method: 'twilio', sid: msg.sid };
    }

    // ── Fallback: carrier email-to-SMS gateway ───────────────────────────
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        const gatewayAddress = getSmsEmail(phone, carrier);
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: false,
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        });
        await transporter.sendMail({
            from:    SMTP_FROM,
            to:      gatewayAddress,
            subject: '',   // SMS gateways ignore the subject
            text:    body
        });
        console.log(`[SMS] Gateway sent to ${gatewayAddress}`);
        return { method: 'gateway', address: gatewayAddress };
    }

    throw new Error('No SMS transport configured. Set TWILIO_* or SMTP_* environment variables.');
}

module.exports = { sendSms };
