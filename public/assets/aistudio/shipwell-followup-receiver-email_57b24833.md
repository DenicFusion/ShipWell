# ShipWell — Follow-up Prompt: Receiver Invite Email ("A parcel is on its way to you")

Add this to the existing ShipWell build. It makes the **sender → receiver email** work exactly like the reference screenshots I'm attaching (a "Track your application" email with a logo, short friendly copy, one big button, a copy-link fallback, and the exact email the person should use). Use the same pattern, but with **ShipWell branding and ShipWell wording** (do not copy the other company's logo or name).

---

## 1. When it fires

The moment a sender **confirms a booking**, the system sends an email to `receiver.email`:

| Receiver state | Email sent |
|---|---|
| Has **no account** | **Invite email** (section 2) — "Create my account" button |
| Already **has an account** | **"On its way" email** (section 3) — "Track my parcel" button, sign-in link instead of sign-up |

Also send:
- **Reminders** to unregistered receivers: after 48 hours and after 5 days (stop after 3 total emails, or as soon as they sign up). Same template, subject starts with "Reminder:".
- **Resend** whenever the admin clicks "Send invite" (Parties panel and Customers → "Receivers not signed up yet").
- **Sender confirmation** email at booking: tracking code, route, ETA, price, and a line saying "We've emailed {receiver name} at {receiver email} so they can follow it too."
- Later events (checkpoint, delay/hold, **action required**, delivered) go to the receiver once they have an account — and, until they sign up, as a short reminder to sign up to see them.

Send asynchronously through a queue (Resend / Postmark / SES / SendGrid) with retries; log every send (to, template, status, time) and show "Invite sent · {time}" in the admin Parties panel.

## 2. Invite email (receiver has no account)

**Subject:** `{Sender first name} is sending you a parcel — track it on ShipWell`
**Preheader (hidden preview text):** `Create your free account to see live progress and the item photos.`
**From:** `ShipWell <notifications@yourdomain.com>` · **Reply-To:** support address (footer says "Questions? Reply to this email.")

**Layout** (match the reference): dark-friendly, single column, max-width 560px, generous padding, big readable text.

1. ShipWell logo (emerald rounded square + truck icon + "ShipWell" wordmark) at top-left.
2. Heading (bold, large): **A parcel is on its way to you**
3. Body copy:
   - `Hello {Receiver first name}. {Sender full name} has shipped **{contents}** to you from {origin city}, {origin country}.`
   - `Your tracking number is **{SW-20260531-A8F4B2C1}**` (monospace, uppercase) `· Estimated delivery {date}.`
   - `ShipWell is the live tracking platform for this shipment. Every checkpoint, delay and delivery update — and the photos {Sender first name} uploaded of the item — appear on your dashboard.`
   - `Create your free account to see it.`
4. **Primary button** (emerald `#10B981`, dark text, rounded, full width on mobile): **Create my account**
5. `Or copy this link into your browser:` followed by the full URL, written out as plain selectable text (so it works when buttons are blocked).
6. **Email hint line:** `Use **{receiver email}** and your parcel finds you. Already made an account? **Sign in**.` — the email address and "Sign in" are links.
7. Small muted footer: `You are getting this because {Sender full name} entered your email when booking a ShipWell shipment. Questions? Reply to this email.` plus company name/address and an "I don't know this sender" link (see section 5).

**Do not put item photos, home address, price, or phone numbers in the email** — only contents, route, code and ETA. Photos are visible only after sign-in.

## 3. "On its way" email (receiver already has an account)

Same design. Subject: `A parcel from {Sender first name} is on its way to you`. Copy: same first two lines, then `It's already on your ShipWell dashboard.` Button: **Track my parcel** → `/track/{CODE}` (login required if the session expired). Under it: `Not you? Sign in with a different account`.

## 4. The link — how it behaves

- Button/URL: `https://yourdomain.com/track/{CODE}?invite={signed_token}`.
- `signed_token` = random, single-purpose, expiring (30 days), tied to that shipment + receiver email. Store hashed. Never put the email or personal data in the URL.
- **Opening the link while signed out:** show the normal tracking sign-up gate (blurred timeline), but with the **sign-up form already open, the email prefilled and locked** to `receiver.email`, and the heading "Welcome, {first name} — create your account to see {CODE}".
- **After sign-up (or login)** with that email: mark email verified (they proved ownership by clicking), redirect straight to the full tracking page for that parcel, and the parcel also appears in **Dashboard → On Its Way To You** with the sender's photos.
- If they sign up manually later (without the link) using the same email, the parcel still appears automatically — linking is by lowercase email match.
- Expired token: show "This link has expired — enter your email and we'll send a new one."
- If someone logs in with a **different** email than the invited one, show: "This parcel was sent to {masked email}. Sign in with that email to see it." (mask e.g. `e*****n@gmail.com`).

## 5. Safety & compliance

- Rate-limit invites per sender (e.g., max 5 emails to the same address per day) and per IP.
- Include an **"I don't know this sender"** link that flags the shipment for admin review and stops reminders.
- Unsubscribe link in reminders (transactional notices about an active parcel can still be sent).
- Set SPF, DKIM, DMARC on the sending domain; use a dedicated subdomain for notifications.
- Plain-text alternative for every email; subject and body escaped against injection (sender names, contents are user-supplied).

## 6. Email build requirements

- Table-based, inline-CSS responsive HTML that renders in Gmail (incl. dark mode), Apple Mail, Outlook. Test at 360px width.
- Colors: background `#07090F` or white-safe equivalent with dark-mode support; card `#0D1117`; text `#F1F5F9`; muted `#94A3B8`; button `#10B981`; mono font for tracking code. Provide a light-mode fallback.
- Logo as hosted PNG (2×) with alt text "ShipWell".
- Templates as reusable components so the other emails (checkpoint, delay, action required, delivered, password reset) share the same header, button and footer.
- Admin panel addition: in **Shipment detail → Parties**, show the invite history (sent / reminder / opened / account created) and keep the **Send invite** button for manual resends.

## 7. Acceptance checklist

- [ ] Booking with a new receiver email sends the invite email within a minute; booking with an existing user's email sends the "On its way" email.
- [ ] Email content and layout match the reference screenshots (logo, bold heading, short copy, big button, copy-link text, "Use {email}…" line, muted footer).
- [ ] Clicking the button opens the sign-up gate with the email prefilled and locked; after sign-up the receiver lands on the tracking page and sees the parcel and sender photos on the dashboard.
- [ ] Reminders go out at 48 h and 5 days and stop once the receiver signs up.
- [ ] Admin can resend the invite and see its history.
- [ ] No photos or private data appear in any email.
- [ ] Emails render correctly in Gmail dark mode on mobile.
