URGENT FIX. Do NOT redesign anything. Keep my current design.

PROBLEM 1: BOOKING IS BROKEN
On the Ship page, step 4 "Confirm booking":
- "Pay on delivery/pickup": the button stays stuck on "Processing booking..." forever.
- "Pay now" (Card/Bank via Bachs): same stuck spinner, and the Bachs checkout never appears.
Fix both. Work in this order and do not skip a step.

STEP A. DIAGNOSE FIRST (no guessing, no rewriting yet)
1. Start with "Pay on delivery". It needs no payment gateway, so if it hangs, the fault is in booking creation itself.
2. Add temporary logging at every step: button click, form validation, photo uploads, the call to `createBooking`, its response, the Firestore write, the redirect/overlay.
3. Open the browser console, the Network tab, and Firebase Functions logs. Find where it stops. Check each of these:
   - Is `createBooking` (Cloud Function) even deployed and reachable? Cloud Functions and the Admin SDK need an OWNED Firebase project on the Blaze plan. If this project is on the Starter tier or Google-managed, say so clearly.
   - Firestore and Storage security rules blocking the write (permission-denied).
   - Photo upload to Storage never finishing, or an upload failing silently.
   - An `await` that never resolves, a missing try/catch/finally, or an error swallowed so the spinner never clears.
   - App Check or auth: user not signed in or the token expired.
   - A wrong field name or a validation error that is thrown but never shown.
4. Write down the ROOT CAUSE in one or two plain sentences BEFORE changing code.

STEP B. FIX PAY ON DELIVERY
- The booking is created with status "Booked, payment due at pickup", a tracking code is issued (uppercase, like SW-20260531-A8F4B2C1), and the success screen appears.
- The Confirm button locks against double clicks, ALWAYS ends in success or a clear error with a "Try again" button, and times out after 30 seconds with a friendly message. Wrap everything in try/catch/finally so the spinner can never hang.

STEP C. FIX PAY NOW (BACHS) AND MAKE THE CHECKOUT APPEAR
After pressing Confirm with Pay now, log and verify each step:
1. `createBooking` runs on the server, recalculates the price on the server, saves the booking as `awaiting_payment`, and returns ONLY a `checkout_url`.
2. The server calls Bachs `POST /v1/checkout-sessions` using the keys saved in Admin > Settings > Payments (secret key, product ID, sandbox or live). Follow the Bachs reference in `shipwell-bachs-customs-payments-prompt.md` section 0 exactly: custom-priced `product_cart` item with the amount as a decimal string (e.g. "38.40"), `customer.email`, `return_url`, `cancel_url`, `Authorization: Bearer <secret key>`.
3. Check that the keys and product ID are actually saved and decrypt correctly on the server, that the product is custom-amount enabled, and that sandbox/live matches the key. If anything is missing, show a clear admin-facing message ("Bachs is not configured") and a friendly customer message, never a spinner.
4. In the browser, load `https://checkout.bachs.io/bachs.js`, call `Bachs.Initialize({ onEvent })`, then `Bachs.Checkout.open({ checkoutUrl })`. Confirm the script loads (check Network and any Content Security Policy blocking it) and that `Bachs.Checkout.open` is really called.
5. The AI Studio preview runs inside an iframe, which can block the overlay. If the overlay does not open within 3 seconds, or the script fails to load, FALL BACK to opening `checkout_url` in a new tab/redirect, with a visible "Continue to payment" button the customer can tap. The checkout must always appear one way or the other.
6. Overlay events (`checkout.completed`, `checkout.failed`, `checkout.error`, `checkout.closed`) only drive the UI. If the customer closes or cancels, return to step 4 with all data kept and a notice "Payment not completed".
7. Payment is confirmed ONLY by the Bachs webhook (verify `X-Bachs-Timestamp` and `X-Bachs-Signature` HMAC-SHA256 of `${timestamp}.${rawBody}` on the raw body, 300 second tolerance, timing-safe compare, dedupe on event id, match amount and currency). It flips the booking to Paid/Booked and then sends the emails. The success page shows "Confirming your payment..." and listens live to the booking.
8. Never print keys in logs or send them to the browser. Do not ask me to paste any keys in this chat; keys go only in Admin > Settings.

STEP D. PROVE IT
Run both flows in the preview and show me the result:
- Pay on delivery: booking created, success screen, tracking code shown.
- Pay now: Bachs checkout opens (overlay or fallback tab), one sandbox payment completes, the booking flips to Paid, emails go out once.
- Cancel at Bachs: back at step 4, data kept, nothing dispatched.
- Double click Confirm: only one booking.
- Force a failure (turn off network): a clear error and a Try again button appear, the spinner stops.
If something needs the Blaze plan or an owned Firebase project, STOP and tell me plainly in simple words what I must do, with the exact steps. Do not fake it with mock data.

PROBLEM 2: EMAIL NOW USES ONE SUBDOMAIN, mail.shipwell.cc, FOR SENDING AND RECEIVING
It is already VERIFIED in my Resend with sending and receiving both enabled. Do not change DNS. Do NOT use info.shipwell.cc for email anywhere (it points to Vercel).
- Sending: `ShipWell <notifications@mail.shipwell.cc>`.
- Receiving: the support inbox is `support@mail.shipwell.cc`. Show it in the footer, the Support page (with a Copy button) and the emails' footers.
- Admin replies are sent from `ShipWell Support <support@mail.shipwell.cc>` with `Reply-To: support@mail.shipwell.cc`.
- Resend inbound is enabled on mail.shipwell.cc. Point its webhook to the Cloud Function `inboundEmail` (verify the signature, dedupe on event id). An email sent to support@mail.shipwell.cc creates or appends to a support thread in Admin > Messages, matched by sender email and the ticket id in the subject.
- Secrets (server only, editable from Admin > Settings > Email): `RESEND_API_KEY`, `EMAIL_FROM="ShipWell <notifications@mail.shipwell.cc>"`, `EMAIL_REPLY_TO="support@mail.shipwell.cc"`, `SUPPORT_INBOX=support@mail.shipwell.cc`, `RESEND_INBOUND_SECRET`.
- Replace every old `info.shipwell.cc` address (including `support@info...` and `notifications@info...`) with the mail.shipwell.cc version. In Admin > Settings > Email show "Domain: mail.shipwell.cc (sending and receiving)" and a "Send test email" button.

ACCEPTANCE
- [ ] Pay on delivery books and shows the success screen, no stuck spinner
- [ ] Pay now: Bachs checkout appears (overlay or fallback), sandbox payment flips the booking to Paid via webhook
- [ ] Any failure shows a clear error with Try again, spinner never hangs past 30 seconds
- [ ] Email to support@mail.shipwell.cc appears in Admin > Messages
- [ ] Admin reply arrives from mail.shipwell.cc and replies come back to support@mail.shipwell.cc
- [ ] No leftover info.shipwell.cc anywhere in the code, settings or emails

When done, tell me in 5 lines: the root cause you found, what you fixed, and anything I must do myself.
