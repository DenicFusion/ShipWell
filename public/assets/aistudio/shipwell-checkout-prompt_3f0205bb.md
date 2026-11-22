# ShipWell — Booking Checkout (short prompt for the builder)

Make the **booking checkout** (Ship wizard, step 4 "Confirm" → payment → booked) work perfectly end to end. Keep my current design. Backend: Firebase (Auth, Firestore, Functions) and **Bachs** for card and bank payments (keys come from Admin → Settings → Payments, see the Bachs prompt). Do not change the other steps.

## Flow
1. **Confirm step:** summary (route, weight, service, pickup, ETA, price lines, total), payment method choice, terms checkbox, **Confirm booking** button. The button is disabled until the terms box is ticked and every earlier step is valid. Clicking an incomplete step's error scrolls to the first problem.
2. **Server decides the price.** The browser sends only the form data. A callable `createBooking` re-validates everything and **recalculates the total on the server** with the same pricing rules as the quote. Never trust a price from the browser. Reject if the user is not signed in.
3. **Payment methods** (admin can turn each on or off in Settings):
   - **Card / bank transfer (Bachs):** follow the **Bachs reference in `shipwell-bachs-customs-payments-prompt.md` section 0** exactly. In short: the function calls `POST /v1/checkout-sessions` with the custom-priced `product_cart` item and the server-calculated `amount` as a decimal string (e.g. `"36.76"`), the payer's email, `reference = booking_{bookingId}`, `return_url = /dashboard/track/{CODE}?paid=1`, `cancel_url = /dashboard/ship?cancelled=1`, and a unique idempotency key. It returns only `checkout_url`; the browser opens it in the **in-page Bachs overlay** (`Bachs.Checkout.open`) so the customer never leaves the site. Overlay events (`checkout.completed/failed/closed`) only drive the UI. ShipWell never touches card data.
   - **Pay on pickup:** the booking is created immediately as *Booked, payment due at pickup*.
4. **Booking record** is created **before** redirecting, with status `awaiting_payment` (tracking code issued, but the parcel is not dispatched). The **Bachs webhook** (`X-Bachs-Timestamp` + `X-Bachs-Signature` HMAC verified on the raw body, event id de-duplicated, amount and currency matched) flips it to `paid`/`Booked`, then sends the emails. The success page only shows "Confirming your payment…" and listens live to the booking; it never marks anything paid on its own.
5. **Success screen:** tracking number (uppercase, copy button), route, ETA, service, total paid, "Track shipment" (goes to `/dashboard/track/{CODE}` when inside the dashboard), "Book another". The receiver is emailed as soon as the booking is paid (or immediately for Pay on pickup), with the invite link if they have no account.

## It must never get stuck
- **Confirm booking** shows a spinner, locks against double clicks (one booking per click, idempotency key per attempt), and always ends in success or a clear error with a **Try again** button. Time out after 30 seconds with a friendly message.
- Cancelled or failed payment: the user returns to step 4 with their data intact, a notice "Payment not completed", and the booking stays `awaiting_payment`. Unpaid bookings expire after 60 minutes and are cancelled automatically (no dispatch, no emails to the receiver).
- Refresh or back button on any step never loses the form (keep a draft in memory/session and restore it).
- Network errors, expired session (ask to sign in again and continue), duplicate webhook, webhook arriving before the redirect: all handled.

## Rules
- Photos upload to Storage before booking; the booking fails with a clear message if an upload fails.
- Phone numbers validated with libphonenumber (country selector, default from locale, fallback +1).
- Sticky price bar on mobile sits above the bottom tab bar when inside the dashboard.
- Both themes, no horizontal scroll at 360px, loading and error states everywhere.
- Admin sees each booking with payment status (Awaiting payment / Paid / Pay on pickup / Refunded), Bachs reference, and can refund or mark pickup payment received.

## Acceptance
- [ ] Card payment in sandbox: redirect, pay, return, booking flips to Paid via webhook, emails sent once
- [ ] Cancel at Bachs: back at step 4, data kept, nothing dispatched
- [ ] Pay on pickup books instantly
- [ ] Double-click Confirm creates one booking only
- [ ] Changing the price in the browser console changes nothing (server total wins)
- [ ] Spinner never hangs: failure shows an error with Try again
