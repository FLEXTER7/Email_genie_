/**
 * Email Genie — main Express server
 *
 * Routes:
 *   POST /api/signup            — public signup form submission
 *   POST /webhooks/inbound-email — Mailgun inbound parse (email → SMS)
 *   POST /webhooks/sms-reply     — Twilio SMS reply (SMS → CorrLinks email)
 *
 *   GET  /api/contacts/:userId       — get phonebook contacts for a user
 *   POST /api/contacts/:userId       — add/update a contact
 *   DELETE /api/contacts/:userId/:phone — remove a contact
 *
 *   GET  /api/admin/users        — admin: list all users
 *   GET  /api/admin/pending      — admin: pending requests
 *   GET  /api/admin/active       — admin: active users
 *   POST /api/admin/approve/:id  — admin: approve user
 *   DELETE /api/admin/users/:id  — admin: delete user
 *
 * Static files (index.html, admin.html) are served from the project root.
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const crypto     = require('crypto');
const twilio     = require('twilio');
const rateLimit  = require('express-rate-limit');

const db    = require('./server/db');
const sms   = require('./server/sms');
const email = require('./server/email');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Admin authentication ───────────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET && process.env.NODE_ENV === 'production') {
    console.error('FATAL: ADMIN_SECRET must be set in production. Exiting.');
    process.exit(1);
}

const adminSecret = ADMIN_SECRET || 'change-me-in-production';

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // Constant-time comparison to prevent timing attacks
    const provided = Buffer.from(token);
    const expected = Buffer.from(adminSecret);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ── Middleware ─────────────────────────────────────────────────────────────
// Validate CORS_ORIGIN: must be '*' or a well-formed URL origin (scheme+host+port).
const CORS_ORIGIN_ENV = process.env.CORS_ORIGIN || '';
if (!CORS_ORIGIN_ENV && process.env.NODE_ENV === 'production') {
    console.error('FATAL: CORS_ORIGIN must be set in production. Exiting.');
    process.exit(1);
}
function isValidOrigin(value) {
    if (value === '*') return true;
    try {
        const u = new URL(value);
        return u.origin === value;
    } catch {
        return false;
    }
}
// If CORS_ORIGIN is explicitly set, it must be valid. Fail fast rather than silently falling back.
if (CORS_ORIGIN_ENV && !isValidOrigin(CORS_ORIGIN_ENV)) {
    console.error(`FATAL: CORS_ORIGIN is set to an invalid value: "${CORS_ORIGIN_ENV}". Must be '*' or a well-formed URL origin. Exiting.`);
    process.exit(1);
}
// Use the validated env value; fall back to '*' only in non-production.
const allowedOrigin = CORS_ORIGIN_ENV || '*';
// Use a callback so we never pass a dynamic string directly as the cors origin option.
app.use(cors({
    origin(requestOrigin, callback) {
        if (allowedOrigin === '*' || !requestOrigin || requestOrigin === allowedOrigin) {
            callback(null, true);
        } else {
            callback(new Error('CORS: origin not allowed'));
        }
    }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML files from the public directory only
app.use(express.static(path.join(__dirname, 'public')));

// multer for Mailgun multipart inbound email — use any() so attached files don't cause errors
const upload = multer();

// ── Rate limiters ──────────────────────────────────────────────────────────
// Webhook endpoints: generous limit to accommodate legitimate volume bursts,
// but tight enough to throttle abuse.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 120,              // 2 requests/second average
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

// Admin API: tighter limit to protect authentication endpoints.
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

// ── Webhook verification helpers ───────────────────────────────────────────

const MAILGUN_SIGNING_KEY = process.env.MAILGUN_SIGNING_KEY || '';

/**
 * Verify a Mailgun inbound-email webhook signature.
 * https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
 */
function verifyMailgunSignature(timestamp, token, signature) {
    if (!MAILGUN_SIGNING_KEY) return true; // skip verification if key not set (dev only)
    const value = timestamp + token;
    const computed = crypto.createHmac('sha256', MAILGUN_SIGNING_KEY).update(value).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature || ''));
    } catch {
        return false;
    }
}

/**
 * Verify a Twilio inbound-SMS webhook signature.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function verifyTwilioSignature(req) {
    if (!TWILIO_AUTH_TOKEN) return true; // skip verification if unconfigured (dev only)
    const signature = req.headers['x-twilio-signature'] || '';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body);
}

// ── Helper ─────────────────────────────────────────────────────────────────
function generateBridgeEmail() {
    const ts  = Date.now().toString(36);
    const rnd = crypto.randomBytes(3).toString('hex');
    return `user-${ts}-${rnd}@emailgenie.org`;
}

// Strip characters that could be used for email header injection or misleading SMS content.
function sanitizeText(value, maxLen = 200) {
    if (!value) return '';
    return String(value).replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen);
}

// ── Public signup ──────────────────────────────────────────────────────────
app.post('/api/signup', (req, res) => {
    try {
        const { name, email: userEmail, phone, carrier, corrlinks_email, inmate_name } = req.body;

        if (!name || !userEmail || !phone || !carrier) {
            return res.status(400).json({ error: 'name, email, phone, and carrier are required.' });
        }

        // Validate phone: must be a 10-digit US number after stripping non-digits
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length !== 10) {
            return res.status(400).json({ error: 'phone must be a 10-digit US number.' });
        }

        const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
        const user = db.createUser({
            id,
            name,
            email:           userEmail,
            phone,
            carrier,
            corrlinks_email: corrlinks_email || '',
            inmate_name:     inmate_name || '',
            bridge_email:    null,
            status:          'pending',
            created_at:      new Date().toISOString()
        });

        res.json({ success: true, user });
    } catch (err) {
        console.error('[signup]', err);
        res.status(500).json({ error: 'Server error during signup.' });
    }
});

// ── Webhook: Mailgun inbound email → SMS ───────────────────────────────────
//
// Mailgun POSTs a multipart/form-data payload to this endpoint whenever
// an email arrives at any address @emailgenie.org.
//
// Required Mailgun settings:
//   Routes → Match recipient: .*@emailgenie.org
//   Action: forward("https://your-domain.com/webhooks/inbound-email")
//
// Phonebook commands (inmate emails the bridge address to manage contacts):
//   MENU                        — list available commands
//   PHONEBOOK LIST              — show saved contacts
//   PHONEBOOK ADD [name] [phone] — save a contact
//   PHONEBOOK REMOVE [phone]    — remove a contact
//
app.post('/webhooks/inbound-email', webhookLimiter, upload.any(), async (req, res) => {
    try {
        // Verify Mailgun webhook signature
        const { timestamp, token, signature } = req.body;
        if (MAILGUN_SIGNING_KEY && !verifyMailgunSignature(timestamp, token, signature)) {
            console.warn('[inbound-email] Invalid Mailgun signature — request rejected');
            return res.status(403).send('Forbidden');
        }

        const recipient = (req.body.recipient || '').toLowerCase().trim();
        const sender    = sanitizeText(req.body.sender || req.body.from || '(unknown)', 100);
        const subject   = sanitizeText(req.body.subject || '(no subject)', 200);
        const bodyText  = (req.body['body-plain'] || req.body.text || '').trim();

        console.log(`[inbound-email] To: ${recipient}  From: ${sender}  Subject: ${subject}`);

        // Look up subscriber by bridge email
        const user = db.getUserByBridgeEmail(recipient);
        if (!user) {
            console.warn(`[inbound-email] No user found for bridge email: ${recipient}`);
            return res.status(200).send('ok');   // always 200 so Mailgun stops retrying
        }

        // ── Phonebook command handling ────────────────────────────────────
        const cmdLine = bodyText.split('\n')[0].trim().toUpperCase();

        if (cmdLine === 'MENU') {
            const menu =
`Email Genie — Available Commands

Send any of these commands to your bridge email address:

MENU
  Show this help message.

PHONEBOOK LIST
  Show all saved contacts.

PHONEBOOK ADD [name] [phone]
  Save a contact. Example: PHONEBOOK ADD Mom 5551234567

PHONEBOOK REMOVE [phone]
  Remove a contact. Example: PHONEBOOK REMOVE 5551234567

Your saved contacts are used as the "From" name on emails you
receive, so prison staff sees a real name instead of a number.`;
            await sms.sendSms(user.phone, user.carrier, menu.slice(0, 1600));
            return res.status(200).send('ok');
        }

        if (cmdLine.startsWith('PHONEBOOK ')) {
            const args = bodyText.trim().replace(/^PHONEBOOK\s+/i, '');
            const subCmd = args.split(/\s+/)[0].toUpperCase();

            if (subCmd === 'LIST') {
                const contacts = db.getContactsByUserId(user.id);
                let reply;
                if (contacts.length === 0) {
                    reply = 'Your phone book is empty.\nSend: PHONEBOOK ADD [name] [phone]';
                } else {
                    reply = 'Your saved contacts:\n' +
                        contacts.map(c => `  ${c.name}: ${c.phone}`).join('\n');
                }
                await sms.sendSms(user.phone, user.carrier, reply.slice(0, 1600));
                return res.status(200).send('ok');
            }

            if (subCmd === 'ADD') {
                // Expects: ADD [name] [phone]  (name may contain spaces; phone is last token)
                const tokens = args.replace(/^ADD\s+/i, '').trim().split(/\s+/);
                if (tokens.length >= 2) {
                    const contactPhone = tokens[tokens.length - 1];
                    const contactName  = sanitizeText(tokens.slice(0, -1).join(' '), 100);
                    db.upsertContact(user.id, contactPhone, contactName);
                    await sms.sendSms(user.phone, user.carrier, `Saved: ${contactName} → ${contactPhone.replace(/\D/g, '')}`);
                } else {
                    await sms.sendSms(user.phone, user.carrier, 'Usage: PHONEBOOK ADD [name] [phone]\nExample: PHONEBOOK ADD Mom 5551234567');
                }
                return res.status(200).send('ok');
            }

            if (subCmd === 'REMOVE') {
                const contactPhone = args.replace(/^REMOVE\s+/i, '').trim();
                if (contactPhone) {
                    db.deleteContact(user.id, contactPhone);
                    await sms.sendSms(user.phone, user.carrier, `Removed contact for ${contactPhone.replace(/\D/g, '')}.`);
                } else {
                    await sms.sendSms(user.phone, user.carrier, 'Usage: PHONEBOOK REMOVE [phone]\nExample: PHONEBOOK REMOVE 5551234567');
                }
                return res.status(200).send('ok');
            }

            // Unknown subcommand — show help
            await sms.sendSms(user.phone, user.carrier,
                'Unknown PHONEBOOK command. Available: LIST, ADD [name] [phone], REMOVE [phone]');
            return res.status(200).send('ok');
        }
        // ── End phonebook command handling ────────────────────────────────

        // Compose SMS — Twilio supports up to 1600 chars (10 segments);
        // keep messages reasonably sized to avoid extra charges.
        const MAX_SMS_LEN = 1600;
        let msgBody = `CorrLinks msg from ${sender}:\n${bodyText}`;
        if (msgBody.length > MAX_SMS_LEN) {
            msgBody = msgBody.slice(0, MAX_SMS_LEN - 3) + '...';
        }

        await sms.sendSms(user.phone, user.carrier, msgBody);
        console.log(`[inbound-email] SMS sent to ${user.phone} for user ${user.id}`);

        res.status(200).send('ok');
    } catch (err) {
        console.error('[inbound-email] Error:', err.message);
        // Return 200 so Mailgun doesn't keep retrying; log for investigation
        res.status(200).send('error logged');
    }
});

// ── Webhook: Twilio SMS reply → CorrLinks email ────────────────────────────
//
// Twilio calls this endpoint when a subscriber replies to a text.
//
// Required Twilio settings:
//   Phone Numbers → Messaging → "A message comes in" webhook:
//   POST https://your-domain.com/webhooks/sms-reply
//
app.post('/webhooks/sms-reply', webhookLimiter, async (req, res) => {
    try {
        // Verify Twilio webhook signature
        if (TWILIO_AUTH_TOKEN && !verifyTwilioSignature(req)) {
            console.warn('[sms-reply] Invalid Twilio signature — request rejected');
            return res.status(403).type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
        }

        const fromNumber = (req.body.From || '').replace(/\D/g, '');
        const body       = (req.body.Body || '').trim();

        console.log(`[sms-reply] From: ${fromNumber}  Body: ${body}`);

        // Look up subscriber by phone number
        const user = db.getUserByPhone(fromNumber);
        if (!user) {
            console.warn(`[sms-reply] No user found for phone: ${fromNumber}`);
            // Reply with a TwiML that tells the sender the number is unknown
            return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Sorry, we couldn't find an account linked to this number. Visit emailgenie.org to sign up.</Message>
</Response>`);
        }

        if (!user.corrlinks_email) {
            console.warn(`[sms-reply] User ${user.id} has no CorrLinks email stored`);
            return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>No CorrLinks email address on file. Please contact support@emailgenie.org.</Message>
</Response>`);
        }

        // Use the inmate's saved display name for this subscriber's phone if one exists
        // (set via "PHONEBOOK ADD [name] [phone]" email command), otherwise fall back to
        // the subscriber's account name. This ensures CorrLinks shows a real name in the
        // message subject rather than a generic label.
        const contactName = db.lookupContactName(user.id, fromNumber) || user.name;
        await email.forwardSmsToEmail(user.corrlinks_email, sanitizeText(contactName, 100), body);
        console.log(`[sms-reply] Forwarded to CorrLinks: ${user.corrlinks_email}`);

        // Empty TwiML response — don't send an auto-reply SMS
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    } catch (err) {
        console.error('[sms-reply] Error:', err.message);
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }
});

// ── Contacts / Phonebook API ───────────────────────────────────────────────

// Apply rate limiting to all /api/* routes (they all require admin auth)
app.use('/api/', adminLimiter);

app.get('/api/contacts/:userId', requireAdmin, (req, res) => {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(db.getContactsByUserId(req.params.userId));
});

app.post('/api/contacts/:userId', requireAdmin, (req, res) => {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const { phone, name } = req.body;
    if (!phone || !name) return res.status(400).json({ error: 'phone and name are required.' });
    const contact = db.upsertContact(req.params.userId, phone, sanitizeText(name, 100));
    res.json({ success: true, contact });
});

app.delete('/api/contacts/:userId/:phone', requireAdmin, (req, res) => {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    db.deleteContact(req.params.userId, req.params.phone);
    res.json({ success: true });
});

// ── Admin API ──────────────────────────────────────────────────────────────
app.get('/api/admin/users',   requireAdmin, (_req, res) => res.json(db.getAllUsers()));
app.get('/api/admin/pending', requireAdmin, (_req, res) => res.json(db.getPendingUsers()));
app.get('/api/admin/active',  requireAdmin, (_req, res) => res.json(db.getActiveUsers()));

app.post('/api/admin/approve/:id', requireAdmin, async (req, res) => {
    try {
        const user = db.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const bridgeEmail = user.bridge_email || generateBridgeEmail();
        const updated     = db.activateUser(req.params.id, bridgeEmail);

        // Send approval notification email to subscriber
        try {
            await email.sendApprovalEmail(updated);
        } catch (emailErr) {
            console.warn('[approve] Could not send approval email:', emailErr.message);
            // Not fatal — the admin can still manually notify the user
        }

        res.json({ success: true, user: updated });
    } catch (err) {
        console.error('[approve]', err);
        res.status(500).json({ error: 'Server error during approval.' });
    }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    try {
        const user = db.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        db.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[delete user]', err);
        res.status(500).json({ error: 'Server error during deletion.' });
    }
});

// ── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Email Genie server listening on port ${PORT}`);
    console.log(`  Admin token: ${ADMIN_SECRET ? '✓ configured' : '⚠️  using default — set ADMIN_SECRET in .env'}`);
});

module.exports = app; // for testing
