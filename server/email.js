/**
 * Email helper — sends emails via SMTP (Mailgun SMTP or any provider).
 * Used to forward subscriber SMS replies back to CorrLinks.
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

function getTransporter() {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables.');
    }
    return nodemailer.createTransport({
        host:   SMTP_HOST,
        port:   SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
}

/**
 * Forward a subscriber's SMS reply to a CorrLinks email address.
 *
 * @param {string} toEmail      - inmate's CorrLinks address
 * @param {string} fromName     - subscriber's name (shown to inmate)
 * @param {string} smsBody      - text message content
 */
async function forwardSmsToEmail(toEmail, fromName, smsBody) {
    // Sanitize fromName to prevent email header injection
    const safeName = String(fromName || 'Subscriber').replace(/["'\r\n\\]/g, ' ').trim().slice(0, 100);
    const transporter = getTransporter();
    const info = await transporter.sendMail({
        from:    `"${safeName} via Email Genie" <${SMTP_FROM}>`,
        to:      toEmail,
        subject: `Message from ${safeName}`,
        text:    smsBody
    });
    console.log(`[Email] Forwarded SMS→Email to ${toEmail} — messageId: ${info.messageId}`);
    return info;
}

/**
 * Send approval notification email to a newly approved subscriber.
 *
 * @param {object} user - user record from the database
 */
async function sendApprovalEmail(user) {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
        from:    `"Email Genie" <${SMTP_FROM}>`,
        to:      user.email,
        subject: 'Your Email Genie bridge address is ready!',
        text:
`Hi ${user.name},

Your Email Genie bridge email is ready:

  Bridge Email: ${user.bridge_email}

How to use:
1. Add this email address as a contact in your CorrLinks account.
2. Any emails sent to this address will arrive as text messages on your phone.
3. Reply to those texts and they will be forwarded back through CorrLinks.

─────────────────────────────────────
PHONE BOOK COMMANDS
─────────────────────────────────────
To manage your contact phone book, email your bridge address with one of
these commands as the message body:

  MENU
    Show all available commands.

  PHONEBOOK LIST
    See all your saved contacts.

  PHONEBOOK ADD [name] [phone]
    Save a person's name for their phone number.
    Example message body:  PHONEBOOK ADD Mom 5551234567

  PHONEBOOK REMOVE [phone]
    Remove a saved contact.
    Example message body:  PHONEBOOK REMOVE 5551234567

When someone texts your phone and you have them saved in your phone book,
their saved name will appear as the sender in your CorrLinks inbox instead
of a generic label — so prison staff sees a real name, not just a number.

─────────────────────────────────────

Questions? Contact support@emailgenie.org.

– Email Genie Team
`
    });
    console.log(`[Email] Approval email sent to ${user.email} — messageId: ${info.messageId}`);
    return info;
}

module.exports = { forwardSmsToEmail, sendApprovalEmail };
