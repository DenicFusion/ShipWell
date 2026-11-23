THREE FIXES. Keep my current design. Do not redesign anything.

=====================================
FIX 1: BOOKING STILL FAILS (evidence from my phone)
=====================================
- Earlier today (Pay on delivery and Pay now): "Booking SW-20261123-1A0A42EF was recorded, but live shipment details could not load yet. Open Track to view it." So the booking IS saved, but the page cannot read it back.
- Now (both Pay now and Pay on delivery): "Could not create booking." with Try again. The real error is hidden from me, so nobody can see what is wrong.

DO THIS IN ORDER:

1. SHOW THE REAL ERROR. Wrap every step in try/catch. On failure show the friendly message PLUS a small "Details" line with the step name and error code (for example: step=createBooking, code=permission-denied). Also write it to the console and to Firestore `errorLogs` (uid, step, code, message, time) and show it in Admin > Activity. Never show a generic message with no code again.

2. FIND THE ROOT CAUSE. Check each of these and tell me which one it is:
   - Firestore rules blocking the read-back or the write (wrong field in the rule, such as senderUid vs uid). Rules must let the sender read their own booking, the receiver read it by their email once signed up, and admin read all.
   - A missing Firestore index (the error contains a "create index" link; create it).
   - The booking is written to one collection but read from another, or the live listener uses a query that does not match the saved fields.
   - The Cloud Function `createBooking` throwing, not deployed, or called in the wrong region (check Functions logs).
   - App Check enforcement blocking calls from the deployed site or preview (set to monitor mode until it is set up properly).
   - Sending the email inside `createBooking` and letting an email failure cancel the whole booking. An email failure must NEVER fail or hide a booking. Send emails after the booking is saved, in their own try/catch, and retry later.
   - Photo upload to Storage failing or hanging.
   - Cloud Functions need a Firebase project I own on the Blaze plan. If that is the blocker, stop and tell me in simple words exactly what I must click.

3. FIX THE DESIGN OF THE FLOW:
   - `createBooking` saves the booking in one step and RETURNS `{ bookingId, trackingCode, status }` directly.
   - The success screen is built from that returned data. It must NOT depend on a live read to appear. Then the shipment details load in the background with up to 3 automatic retries, and the Track page works even if the first read is slow.
   - Pay on delivery: booking is saved as "Booked, payment due on delivery" and the success screen shows immediately.
   - Pay now (Bachs): follow `shipwell-bachs-customs-payments-prompt.md` section 0. The booking is saved as `awaiting_payment`, the server returns only `checkout_url`, the browser opens the Bachs overlay, and if the overlay is blocked or does not open within 3 seconds, open the `checkout_url` in a new tab with a visible "Continue to payment" button. Only the Bachs webhook marks it Paid.
   - Double click creates only one booking. 30 second timeout with a clear message. The spinner can never hang.

4. PROVE IT in the deployed site (not only the preview): one Pay on delivery booking and one Pay now sandbox booking, each ending on the success screen with the tracking code (uppercase) and visible under Track and in Admin. Then tell me in 5 lines: root cause, what you changed, what I must do myself.

=====================================
FIX 2: BRANDED AUTH EMAILS (verification and password reset)
=====================================
Right now the verification email comes from `noreply@core-trail-jpnh2.firebaseapp.com`, is plain text, has a long firebaseapp.com link, and signs off with my personal Gmail name ("Your denic9426@gmail.com's Apps team"). That is not acceptable. Every email must come from our domain, in the ShipWell look.

Sending domain: `mail.shipwell.cc` (already verified in Resend, sends and receives). Do not use Firebase's default sender anywhere.

USE A DIFFERENT SENDER ADDRESS FOR EACH TYPE OF EMAIL (all on mail.shipwell.cc, all editable in Admin > Settings > Email, one `FROM_*` setting each):
| Email type | From | Reply-To |
|---|---|---|
| Verification, password reset, security alerts | `ShipWell Security <noreply@mail.shipwell.cc>` | none (add the line "This inbox is not monitored. Need help? support@mail.shipwell.cc") |
| Shipment updates, tracking, delivery, receiver invites, draft reminders | `ShipWell Tracking <tracking@mail.shipwell.cc>` | `support@mail.shipwell.cc` |
| Booking confirmations, receipts, customs charges, refunds | `ShipWell Billing <billing@mail.shipwell.cc>` | `support@mail.shipwell.cc` |
| Support replies from admin | `ShipWell Support <support@mail.shipwell.cc>` | `support@mail.shipwell.cc` |
Only `support@` receives mail (inbound webhook, as before). Mail sent to noreply@, tracking@ or billing@ is ignored or forwarded to the support inbox. The email log shows which sender each email used.

BUILD:
1. A Cloud Function (server only) that creates the verification link (sent FROM `noreply@mail.shipwell.cc`, no Reply-To) with the Admin SDK `generateEmailVerificationLink(email, { url: "https://shipwell.cc/auth/action?next=/dashboard" })` and sends it through Resend with a branded HTML email. Same for password reset with `generatePasswordResetLink`, and for the "email changed" notice. Trigger the verification email right after sign-up and from a "Resend verification email" button (rate limited to once per 60 seconds).
2. Our own page `/auth/action` on shipwell.cc that handles `mode=verifyEmail` and `mode=resetPassword` (with `applyActionCode` / `confirmPasswordReset`). The links in emails must go to `https://shipwell.cc/auth/action?...`, never to firebaseapp.com. The page shows the ShipWell look (both themes), a success or "link expired" state, and a button to the dashboard or login.
3. Email design (responsive HTML + plain-text version, same look for every sender): dark ShipWell look with the emerald button "Verify my email", short friendly text ("Welcome to ShipWell, {name}"), the link also shown as plain text, "If you did not create this account, ignore this email", footer with support@mail.shipwell.cc and https://shipwell.cc (for noreply emails add "This inbox is not monitored"). Signed "The ShipWell team". No personal Gmail name anywhere.
4. In the Firebase console, tell me the exact clicks for: Authentication > Templates (set sender name to "ShipWell", reply-to to support@mail.shipwell.cc, action URL to https://shipwell.cc/auth/action as a fallback), and Authentication > Settings > Authorized domains (add shipwell.cc, www.shipwell.cc, ship-well.vercel.app). Also set the project's public-facing name to "ShipWell".
5. Log every auth email in Firestore `mail/{id}` and show them in Admin > Email log with delivered/bounced status. Resend failures are logged and retried; they never block sign-up.
6. Do not ask me to paste keys in chat. The Resend key is already in Admin > Settings > Email.

=====================================
FIX 3: DRAFT SHIPMENTS (nothing is lost if the form is not finished)
=====================================
If a customer starts a shipment and does not finish it, it becomes a **Draft**, never a lost form and never a half-booking.
1. **Auto-save:** after every step (Addresses, Package, Service) and when the customer leaves, closes the app or taps Back, save the form to Firestore `drafts/{uid}/items/{draftId}` (fields, selected service, last completed step, uploaded photo paths, updatedAt). Debounce while typing. Works on a refresh, on another device, and after logging out and in. A signed-out visitor keeps the form in session storage and it is saved to their account when they sign up or log in.
2. **A draft is not a booking:** no tracking code, no price lock, no payment, no emails to the receiver, and it does not appear in Incoming, Track or the admin shipment list. The price is recalculated by the server when the customer resumes.
3. **Where drafts show:**
   - Dashboard > **Sent** tab: a "Drafts" section at the top with cards (route, package, last step, "Saved 2 hours ago", **Continue** and **Delete** buttons).
   - Dashboard > Home: a banner "You have an unfinished shipment. Continue" when a draft exists.
   - The Ship page: if a draft exists, ask "Continue your draft or start a new shipment?".
4. **Continue** reopens the wizard at the exact step with every field and photo restored. Finishing it books it normally and the draft is deleted automatically. **Delete** asks for confirmation, then removes the draft and its unused photos.
5. Up to 5 drafts per user. Drafts older than 30 days are deleted automatically (scheduled function), with the photos.
6. **Reminder email** (once, 24 hours after the last edit, only if the draft is still unfinished): "Your shipment to {city} is waiting" with a Continue button, sent from `tracking@mail.shipwell.cc`, with an unsubscribe-safe footer. Never sent twice for the same draft.
7. A failed booking (see Fix 1) also leaves the draft intact, so the customer can press Try again without retyping anything.
8. Admin > Overview shows a small "Drafts today" count (no personal details). Both themes, 360px mobile, loading and empty states.

=====================================
FIX 3: SITE 404 ON /admin (Vercel)
=====================================
Opening https://www.shipwell.cc/admin shows "404 NOT_FOUND" from Vercel. Cause: the site is a single-page app, and Vercel looks for a real file at /admin. Direct links and refreshes (/admin, /track, /ship, /dashboard, /auth/action) all break the same way.
Fix: add a `vercel.json` in the project root and redeploy:
{ "rewrites": [ { "source": "/(.*)", "destination": "/index.html" } ] }
(If the app is Next.js, no file is needed; instead make sure /admin exists as a route.) Also:
- Make `www.shipwell.cc` redirect to `shipwell.cc` (or the reverse), one main address only, and use that address in every email link and in Firebase Authorized domains.
- ADMIN MOVES TO ITS OWN ADDRESS: `https://admin.shipwell.cc` (see FIX 3B). Do not link to it anywhere on the public site. Unknown routes show a branded ShipWell "Page not found" page with a button home, not Vercel's 404.
- Test after deploying: shipwell.cc/admin, /track, /ship, /dashboard and /auth/action all load directly and after refresh.

=====================================
FIX 3B: ADMIN PANEL ON admin.shipwell.cc
=====================================
Admin panel lives at `https://admin.shipwell.cc`. Same app, same Firebase project, same deployment. One build, two hostnames.
1. Vercel: Project > Settings > Domains > add `admin.shipwell.cc`. Tell me the exact DNS record Vercel shows (a CNAME for host `admin`), and I will add it at my DNS host (Spaceship). Do NOT touch the `mail` records (they are for email).
2. Host-based routing in the app: if `location.hostname` starts with `admin.`, show ONLY the admin panel (admin login at `/`, then Overview, Shipments, Customs, Messages, Email log, Settings). On the public hostnames (shipwell.cc, www) the admin panel is never rendered; `/admin` there redirects to https://admin.shipwell.cc. The public site and the customer dashboard are never reachable on the admin hostname.
3. `vercel.json` rewrite to `index.html` (FIX 3) so every admin page works on direct open and refresh.
4. Firebase Console > Authentication > Settings > Authorized domains: add `admin.shipwell.cc`. Admin signs in on that hostname (sign-in is separate from the main site, that is expected).
5. Security: admin access is decided on the SERVER only (Firebase custom claim `admin: true`, checked in Firestore rules and in every Cloud Function), never by the hostname or a hidden client flag. A normal customer who opens admin.shipwell.cc sees "Access denied". Add `X-Robots-Tag: noindex` and a `robots.txt` Disallow for the admin hostname, and rate limit and log failed admin logins.
6. Emails and links: admin links in notification emails point to https://admin.shipwell.cc. Customer links keep pointing to https://shipwell.cc.
7. Test: admin.shipwell.cc opens the admin login directly, refreshes without a 404, a customer account is denied, and shipwell.cc/admin redirects to admin.shipwell.cc.

=====================================
FIX 4: DIFFERENT SENDER ADDRESS FOR EACH TYPE OF EMAIL
=====================================
All on mail.shipwell.cc (verified, no DNS change). Use these exactly, and make them editable in Admin > Settings > Email:

| Email type | From | Reply-To |
|---|---|---|
| Verify email, password reset, email changed, login alerts | `ShipWell <noreply@mail.shipwell.cc>` | none. Footer says "This is an automatic message, please do not reply. Need help? support@mail.shipwell.cc" |
| Shipment updates (booked, picked up, in transit, delivered, delays) to sender and receiver | `ShipWell Tracking <tracking@mail.shipwell.cc>` | support@mail.shipwell.cc |
| Customs holds, charges, payment links and receipts | `ShipWell Payments <payments@mail.shipwell.cc>` | support@mail.shipwell.cc |
| Receiver invitations ("a parcel is on its way to you, sign up") | `ShipWell <notifications@mail.shipwell.cc>` | support@mail.shipwell.cc |
| Draft reminders and general notices | `ShipWell <notifications@mail.shipwell.cc>` | support@mail.shipwell.cc |
| Support replies from the admin | `ShipWell Support <support@mail.shipwell.cc>` | support@mail.shipwell.cc |

Rules: only `support@mail.shipwell.cc` is a real inbox (inbound webhook creates support threads). Mail sent to noreply@, tracking@ or payments@ is ignored, or gets one automatic "this address is not monitored, contact support@mail.shipwell.cc" reply (max one per sender per day). Every email still follows the receiver's notification preferences, except verification and password reset, which always send.

=====================================
FIX 5: DRAFT SHIPMENTS (incomplete bookings are saved)
=====================================
If someone starts a shipment and does not finish, nothing is lost.
1. Autosave: after each step and every few seconds of typing, save the Ship form as a draft in Firestore `drafts/{uid}` (addresses, package, service, receiver email, photo paths already uploaded, current step, updatedAt). Logged-in users only. Keep a local copy too, so a refresh or a lost connection never loses the form.
2. When the user returns to Ship (or opens the dashboard), show a card: "Continue your shipment: Mumbai to Tulsa, step 3 of 4" with **Continue** and **Discard** buttons. Continue restores every field and the step. Show drafts in the dashboard under Sent as a "Draft" tab or filter, with a Draft badge and the last edited time.
3. A draft is NOT a booking: no tracking code, no price lock, no emails to the receiver, not visible to admin as a shipment. The price is always recalculated when the user continues.
4. Payment not completed (user closed Bachs): the booking stays `awaiting_payment` and also shows under Drafts as "Payment pending" with a **Pay now** button that reopens the Bachs checkout, until it expires after 60 minutes, then it becomes a normal draft again (the user can resume and pay).
5. One reminder email to the SENDER only, 24 hours after the last edit ("You left a shipment unfinished", with a Continue button), from `notifications@mail.shipwell.cc`. Maximum 1 reminder per draft, and none if the user turned reminders off in settings. Drafts older than 30 days are deleted automatically.
6. Admin > Dashboard shows a small "Abandoned drafts" count (no personal details beyond email), for follow up.
7. Firestore rules: a draft is readable and writable only by its owner.

ACCEPTANCE
- [ ] Pay on delivery and Pay now both finish on the success screen on the deployed site
- [ ] Any error shows a step name and error code, and is logged in Admin > Activity
- [ ] A new sign-up gets a branded verification email from notifications@mail.shipwell.cc, link goes to shipwell.cc/auth/action, and clicking it verifies the account
- [ ] Password reset email is branded the same way
- [ ] No firebaseapp.com sender, link or personal Gmail name appears in any email
- [ ] Verification email comes from noreply@mail.shipwell.cc with no reply address; tracking, payments and support emails each use their own sender
- [ ] admin.shipwell.cc opens the admin login and works after refresh; customers are denied; shipwell.cc/admin redirects there
- [ ] shipwell.cc/track, /ship, /dashboard and /auth/action load directly and after refresh (no Vercel 404)
- [ ] Leaving the Ship wizard half way saves a draft; returning shows Continue and the form is restored
- [ ] Draft reminder email sent once after 24 hours, never for completed bookings
- [ ] Verification and password reset come from noreply@, shipment updates from tracking@, receipts and customs charges from billing@, support replies from support@
- [ ] Leaving the form half-way creates a draft under Sent > Drafts; Continue restores every field and photo; finishing deletes the draft
- [ ] A draft has no tracking code and never emails the receiver
- [ ] 24-hour reminder email is sent once; drafts expire after 30 days
