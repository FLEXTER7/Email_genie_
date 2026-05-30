# Email Genie - Free Setup Guide

## ✅ Status: Your Formspree Form is Ready!

**Form ID:** `xlgvvvke`  
**Form URL:** `https://formspree.io/f/xlgvvvke`

Your form is already integrated into `index.html`. When users sign up, all data gets emailed to you automatically.

---

## Overview

This is a completely free email-to-SMS service for CorrLinks. No Supabase, no databases, no subscription costs.

**What you need:**
- ✅ Formspree account (DONE - connected)
- ⏳ Twilio account (free tier - next step)
- ⏳ Google Sheets (optional - for logging)
- ✅ Your domain (already have it: flexter7.github.io)

---

## How Data Flows

```
User fills signup form
         ↓
Bridge email generated automatically
         ↓
All data sent to your Formspree
         ↓
You receive email with their info
         ↓
Bridge email + SMS gateway email included
         ↓
You manually set up email→SMS forwarding (Zapier/Twilio)
         ↓
Emails sent to bridge email → Automatically convert to SMS
```

---

## Step 1: Set Up Twilio (5 minutes) ⏳ DO THIS NEXT

Twilio sends the actual SMS messages. Free tier gives you $15 credit.

1. Go to https://www.twilio.com/console/sms/getting-started
2. Sign up (they ask for a phone number)
3. Verify your phone number
4. They give you a free phone number like `+1234567890`
5. Go to **Account Settings** → **Auth Token**, copy it
6. Go to **Phone Numbers** → **Manage** → **Active Numbers**
7. Copy your **Twilio Phone Number**

**Save these in a safe place:**
- Account SID (found in console)
- Auth Token
- Twilio Phone Number

✅ **Result:** You can now send SMS messages.

---

## Step 2: Set Up Email Forwarding (The Hard Part) ⏳ DO THIS AFTER TWILIO

This is how emails sent to `user-xyz@bridge.emailgenie.app` actually get converted to SMS.

### Option A: Using Zapier (Recommended - Easiest)

1. Go to https://zapier.com
2. Sign up for free
3. Create a **Zap:**
   - **Trigger:** Gmail (or your email service)
   - **Filter:** Email TO contains `@bridge.emailgenie.app`
   - **Action:** Twilio → Send SMS Message
   - **From:** Your Twilio phone number
   - **To:** Extract from SMS email field (from Formspree data)
   - **Message:** Email body

4. When inmate sends email to bridge address:
   - Zapier catches it
   - Extracts phone number from bridge email address
   - Sends as SMS via Twilio
   - You get text instantly

**Why Zapier?** It's the simplest. No coding required.

### Option B: Using Twilio's Built-In Email Integration

1. In Twilio console, go to **Messaging** → **Inbound Settings**
2. Use their Email-to-SMS feature
3. Configure email address → phone number mapping

### Option C: Using Make.com (Even Simpler)

1. Go to https://make.com
2. Create a scenario:
   - **Trigger:** Webhook (generates unique URL)
   - **Action:** Twilio → Send SMS
3. Simpler than Zapier, also free

**RECOMMENDED:** Zapier is most reliable and widely used.

---

## Step 3: Test It Out

1. Visit https://flexter7.github.io/Email_genie_/
2. Fill out the signup form
3. You'll get a confirmation email from Formspree with:
   - User's name, email, phone
   - **Bridge email** (e.g., `user-abc123@bridge.emailgenie.app`)
   - **SMS email** (e.g., `5551234567@tmomail.net`)
   - Timestamp

4. Send a test email to the bridge email address
5. Within seconds, you should receive an SMS to the number they signed up with

---

## Step 4: Real-World Use

Once set up, here's the complete flow:

1. **Inmate in prison** opens CorrLinks
2. **Composes email** to someone outside
3. **Types bridge email** as recipient (e.g., `user-abc123@bridge.emailgenie.app`)
4. **Hits send** in CorrLinks
5. **Email routes through CorrLinks system**
6. **Arrives at your Zapier automation**
7. **Zapier extracts phone number** from the bridge email address
8. **Sends SMS via Twilio** to their contact
9. **Text arrives instantly** on someone's phone
10. **They can reply** by text, which you forward back to CorrLinks

---

## Cost Breakdown

| Service | Cost | Limit |
|---------|------|-------|
| Formspree | **Free** | Unlimited forms |
| Twilio | **Free** | $15 credit (~300 SMS) |
| Zapier | **Free** | 100 tasks/month |
| Google Sheets | **Free** | Unlimited |
| GitHub Pages | **Free** | Unlimited |
| **TOTAL** | **$0** | Fully functional |

After Twilio's $15 runs out, SMS costs $0.0075/message (~3000 SMS = $22.50). Extremely cheap.

---

## What Happens When User Submits Form

1. ✅ User fills out form (name, email, phone, carrier)
2. ✅ JavaScript generates unique bridge email automatically
3. ✅ Calculates SMS gateway email based on carrier
4. ✅ All data submitted to Formspree
5. ✅ Formspree emails you with all details
6. ✅ Success page shows bridge email
7. ✅ User can copy bridge email to clipboard
8. ✅ User adds bridge email to CorrLinks
9. ✅ When inmate emails that address, Zapier converts to SMS

---

## Troubleshooting

### "I signed up but didn't get an email"
- Check spam folder
- Formspree confirmation goes to your email registered with Formspree
- Make sure you have notifications enabled in Formspree

### "Email didn't convert to SMS"
- Check Zapier logs (dashboard shows every attempt)
- Make sure Twilio phone number is verified
- Check your phone carrier (some filter SMS from weird numbers)
- Test sending email from Gmail to bridge address directly

### "Bridge email doesn't work in CorrLinks"
- CorrLinks may have email domain restrictions
- Try submitting support ticket to CorrLinks with bridge email domain
- Ask them to whitelist `@bridge.emailgenie.app`

---

## Next Steps

1. ✅ Formspree set up - DONE
2. Set up Twilio account (5 minutes)
3. Create Zapier automation (10 minutes)
4. Test with form submission
5. Go live!

---

**Last Updated:** 2025-05-30  
**Status:** Ready for Twilio setup
