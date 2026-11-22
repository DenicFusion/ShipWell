# ShipWell — Bachs Payments for Customs Charges + Admin-Managed Keys (send to your builder)

Add this to the v4 update. Goal: when a receiver pays a **customs / duty charge**, the payment goes through the **Bachs payment gateway** (bachs.io), confirmed server-side by webhook. **Every API key and secret is entered in the Admin panel**, never in code or `.env` files (one exception, explained in section 3).

Read the official docs first: https://docs.bachs.io (API reference, Checkout sessions guide, Webhooks, Authentication, Errors). Section 0 is the working reference from my own Bachs integration. Use plain `fetch` for the API and the HMAC check shown there. Where this prompt and the official docs disagree, test in the sandbox and keep what the sandbox accepts.

---

## 0. Reference: how Bachs works (copied from my working Aetheris pay page; follow this)

This is the proven contract. Use it exactly; check docs.bachs.io only for anything not covered here.

- **Base URL:** `https://sandbox-api.bachs.io` (sandbox) or `https://api.bachs.io` (live), chosen by the saved environment. Header `Authorization: Bearer <secret key>`, `Content-Type: application/json`. Keys: `sk_sandbox_...` / `sk_live_...`. Errors come back as `{ detail, error_code, errors? }`: show `detail` to the logs, a friendly message to the user.
- **Money** is always a **decimal string at currency precision**, e.g. `"38.40"`. Never minor units.
- **Create the checkout (server only):** `POST /v1/checkout-sessions` with
  ```json
  { "product_cart": [ { "product_id": "<BACHS_PRODUCT_ID>", "quantity": 1, "amount": "38.40" } ],
    "customer": { "email": "payer@example.com" },
    "return_url": "https://shipwell.cc/dashboard/track/CODE?paid=1",
    "cancel_url": "https://shipwell.cc/dashboard/track/CODE?paid=0" }
  ```
  The product behind `BACHS_PRODUCT_ID` must be a **custom-priced ("pay what you want") product** (`custom_amount_enabled: true`, `price_type: "custom"`), otherwise Bachs rejects the `amount` override. Create one product called "ShipWell payment" in the Bachs dashboard (one for sandbox, one for live) and save its ID in Admin → Settings. The server sets the amount; the browser can never change it. Add `reference` and `metadata` (shipment code, alert/charge id, uid) so the webhook can match the payment. If Bachs rejects `return_url`, use `success_url` (their newer docs name); keep whichever the sandbox accepts. Add a unique idempotency key per attempt. Return **only** `checkout_url` to the browser.
- **Pay in an overlay, without leaving the site:** load `https://checkout.bachs.io/bachs.js` once, call `window.Bachs.Initialize({ onEvent })`, then `window.Bachs.Checkout.open({ checkoutUrl })`. `onEvent` receives `checkout.completed`, `checkout.failed`, `checkout.error`, `checkout.closed`. Use these **only for UI** (show "Confirming your payment…", or "Payment did not complete, try again"). They never mark anything paid. If the overlay cannot load, fall back to redirecting to `checkout_url`.
- **Webhook = the only source of truth.** Bachs sends headers `X-Bachs-Timestamp` and `X-Bachs-Signature`. Verify on the **raw body** (before JSON parsing): `expected = hex( HMAC_SHA256( webhook_secret, timestamp + "." + rawBody ) )`, compare with `timingSafeEqual`, and reject if the timestamp is more than **300 seconds** old. (Newer Bachs docs also describe an `X-Bachs-Signature-V2` header; accept it too if present, and support the previous secret during rotation.) Reply `400` on a bad signature, `{ "received": true }` with 200 when handled, 5xx on internal errors so Bachs retries.
- **Events:** payload is `{ id, type, data }`. `collection.succeeded` has `data: { charge_id, checkout_id, amount, currency }`. Also handle `collection.failed`, `collection.abandoned`, `collection.underpaid`, plus `checkout.expired` and `refund.*`. Delivery is **at least once**, so **dedupe on `event.id`** before applying anything.
- **Environment values** (`BACHS_API_KEY`, `BACHS_ENV`, `BACHS_WEBHOOK_SECRET`, `BACHS_PRODUCT_ID`, site URL) are exactly the settings I manage in **Admin → Settings → Payments**, stored encrypted, not in `.env` files.
- **Security:** my Aetheris README says a live key and webhook secret were once pasted into a chat. Treat anything pasted anywhere as compromised: rotate keys in the Bachs Developer Portal, and never put a secret in a prompt, repo or client code.

---

## 1. How the customs payment works (end to end)

1. Admin adds a customs charge on a shipment (type, amount, note, "hold until paid"). This already creates the receiver's action request, the hold, and the email.
2. Receiver opens **Duties & charges** (or the Action Required card) and taps **Pay**. The button label is **"Pay with Bachs"** (show Stripe/Paystack only if the admin enabled them, see section 4).
3. The browser calls the callable Cloud Function `createCustomsCheckout({ shipmentCode, alertId })`. The server (never the browser):
   - checks the user is signed in and is the receiver (or the sender, if the charge is addressed to the sender), the charge is **open**, and the amount comes from Firestore, **never from the client**;
   - reads the Bachs settings from the admin-managed settings (section 3) and picks sandbox or live from the saved environment;
   - calls `POST /v1/checkout-sessions` on `https://api.bachs.io` (live) or `https://sandbox-api.bachs.io` (sandbox) with header `Authorization: Bearer <secret key>`, with:
     - `product_cart: [{ product_id, quantity: 1, amount: "38.40" }]` (decimal **string**, see section 0)
     - `customer: { email, name, phone_number? }` (the payer)
     - `return_url: https://shipwell.cc/dashboard/track/{CODE}?paid=1`
     - `cancel_url: https://shipwell.cc/dashboard/track/{CODE}?paid=0`
     - `reference: "chg_{CODE}_{alertId}"` (max 128 chars, unique per organization)
     - `metadata: { shipment, alertId, chargeType, uid }` (returned in webhooks)
     - `expires_in_minutes: 60`
     - a unique **idempotency key** per attempt (the SDK does not generate one for you);
   - stores `checkoutId`, `checkoutUrl`, `status`, `expiresAt` on the charge (`shipments/{code}/alerts/{id}.payment`);
   - returns `checkoutUrl`; the browser opens Bachs' checkout in the **in-page overlay** (`Bachs.Checkout.open`, see section 0), with redirect as fallback. **ShipWell never sees or stores card data.**
4. After paying, the customer lands on the success URL. That page shows **"Confirming your payment…"** and listens live to the charge in Firestore. **Redirecting back is not proof of payment**; only the webhook (or a server-side lookup) marks it paid.
5. **Webhook** `bachsWebhook` (HTTPS Cloud Function, public URL `https://shipwell.cc/api/bachs-webhook` rewritten to the function):
   - read the **raw body** (before JSON parsing) and verify the signature with the saved **webhook signing secret** for the active environment. Bachs sends `X-Bachs-Timestamp` and `X-Bachs-Signature` (HMAC-SHA256 of `timestamp.rawBody`, hex; see section 0). Reject anything older than **300 seconds**; keep the server clock in sync. Also try the saved *previous* secret when rotation is active. Reject repeated/malformed signature headers;
   - store each event `id` in `bachsEvents/{id}` in a transaction and **ignore duplicates**;
   - handle these events:
     - `collection.succeeded`: look up the session/payment from Bachs (`GET` retrieve by `checkout_id`) to confirm status, **amount and currency match the charge**, then mark the charge **Paid** (`payment.status="paid"`, paid time, Bachs payment id) and run the hold logic below;
     - `collection.failed`, `collection.abandoned`, `checkout.expired`: record on the charge and in the timeline ("Payment not completed"); the charge stays **Unpaid** and the receiver can tap Pay again (creates a new session);
     - `collection.underpaid`: keep the charge **Unpaid**, show "Underpaid by $X, please pay the balance", notify admin;
     - `refund.created`, `refund.paid`, `refund.failed`: log on the charge and in the admin payment log; admin refunds are triggered from the admin panel (full refunds; follow the docs for partial-refund rules);
   - unknown references: acknowledge with 200 and log; processing errors: return **5xx** so Bachs retries; always respond fast and do the slow work (emails) after.
6. **Hold logic after a successful payment** (already specified in v4): a parcel stays on hold while **any** hold-charge is unpaid. Paying one while another is open keeps the hold ("Still on hold, another action is pending"). When the last one is paid the hold releases automatically, the timeline says "Hold released", and receiver, sender and admin get an email.
7. If admin adds **another** customs charge later, the same flow repeats with a new `alertId`/reference/checkout. Never reuse a checkout for a different charge.

Data to keep per charge: `amount`, `currency`, `type`, `status` (open/paid), `payment: { provider:"bachs", environment, checkoutId, paymentId, status, paidAt, events[] }`. Show it in the admin ledger (Paid chip, Bachs reference, copy button) and in the receiver's Duties & charges card, with a downloadable receipt (email + page).

## 2. Admin → Settings → Payments & Integrations (all keys live here)

A new admin page `/admin/settings` with tabs. Admin-only (custom claim). Every secret field is **write-only**: after saving it displays as `sk_live_••••••••1234` and a **Replace** button; the full value is never sent back to any browser.

**Bachs card**
- Status badge: Not configured / Sandbox / Live, plus "Webhook last received: 2 minutes ago".
- Environment switch **Sandbox | Live**. Switching to Live asks for confirmation and requires a live key and live webhook secret to be saved first.
- Fields: **Bachs product ID** for sandbox and live (the custom-priced product), Sandbox secret key (`sk_sandbox_...`), Live secret key (`sk_live_...`), Sandbox webhook signing secret, Live webhook signing secret, Previous webhook signing secret (optional, for rotation), Organization ID (optional, stricter verification), default currency (USD), checkout expiry minutes (default 60).
- Validate on save: the key prefix must match its field (`sk_sandbox_` vs `sk_live_`); reject mismatches with a clear message.
- **Webhook URL** (read-only, with Copy button) to paste into the Bachs dashboard (Developer Portal → Webhook), plus the list of events to subscribe to: `collection.succeeded`, `collection.failed`, `collection.abandoned`, `collection.underpaid`, `checkout.expired`, `refund.created`, `refund.paid`, `refund.failed`. Short step-by-step help text: where to create API keys (app.bachs.io → Developer Portal → API keys; the key is shown only once) and the webhook destination; use separate destinations for sandbox and live; HTTPS only.
- **Test connection** button: server makes a harmless authenticated call and reports "Connected (sandbox)" or the exact error. **Create test checkout** button (sandbox): makes a $1.00 test session and opens it so admin can test the full loop.
- Recent webhook events table (time, event, reference, result: processed / duplicate / rejected-signature).

**Other cards on the same page** (all editable here, same masking rules):
- **Email (Resend):** API key, From (`ShipWell <notifications@info.shipwell.cc>`), Reply-To / support inbox (`support@info.shipwell.cc`), inbound webhook secret. "Send test email" button.
- **Stripe** and **Paystack** (optional alternative or fallback gateways): public key, secret key, webhook secret, enable toggle each.
- **Gateway routing:** which gateway is used for customs charges (Bachs by default), optional fallback order if one is disabled or errors, and an option to offer the payer a choice when more than one is enabled.
- Anything else the site needs later (maps, SMS, push) follows the same pattern: a card with masked fields and a Test button.

Every change writes an **audit log** entry (who, when, which field; never the value) shown in the page. Role: only `admin`; add `superadmin` later if needed.

## 3. How to store the secrets safely (do not skip)

- Store settings in Firestore at `adminSettings/payments` and secrets in `adminSecrets/{name}` with **security rules that deny all client reads and writes** (`allow read, write: if false`). Only Cloud Functions (Admin SDK) touch them.
- Saving goes through a callable `saveIntegrationSettings` that checks the caller's `admin` claim, validates, **encrypts each secret with AES-256-GCM** (or Google Cloud KMS) before writing, and returns only masked values (`last4`, `updatedAt`, `updatedBy`).
- The **one** thing that cannot live in the admin panel is the encryption key itself (chicken and egg). Keep it as a single Cloud Functions secret `SETTINGS_ENCRYPTION_KEY` (Firebase Secret Manager), set once during deployment by the builder. Every other key is entered in the admin panel.
- Functions read and decrypt secrets at call time (cache for a few minutes, clear the cache when settings change). Never log secrets, never include them in error messages, never return them to the client, never put them in URLs.
- Rate-limit the admin settings endpoints and require a recent sign-in (re-enter password) to change a live key.

## 4. Receiver-side UI

- Duties & charges card: each charge with Pay button (**Pay with Bachs**), status chip, and for paid charges a receipt link. If the Bachs checkout expires, the button simply creates a new one.
- Pay opens the hosted checkout in the same tab (mobile friendly); on return show a clean confirming state, then a success state with the new hold status ("Your parcel is released" or "1 more payment pending").
- Show the amount in USD; if an NGN (or other) equivalent is shown, label it "approx." and charge only in the currency set on the charge.
- Both themes (dark/light) supported, no horizontal scroll at 360px, loading and error states for every step (checkout creation failed, popup/redirect blocked, expired session).

## 5. Security and correctness checklist

- Amount, currency and receiver are **always read from Firestore on the server**, never trusted from the browser.
- One checkout per charge attempt; unique `reference` per charge; idempotency keys on all writes to Bachs.
- Webhook: raw-body signature check, 300s tolerance, secret rotation support, event-id dedupe, amount+currency match, returns 5xx on internal errors so Bachs retries, 200 for unknown references.
- Never mark a charge paid from the success redirect.
- Sandbox and live are fully separated (keys, webhook secrets, data flagged with `environment`); test payments never release real parcels in live mode.
- Failed or abandoned payments never release a hold.

## 6. Acceptance tests
- [ ] Admin saves Bachs sandbox key + sandbox webhook secret in Settings; the page shows masked values; the browser network tab never shows a full secret
- [ ] Wrong-prefix key (live key in sandbox field) is rejected with a clear message
- [ ] Test connection reports Connected (sandbox); Create test checkout opens Bachs hosted checkout
- [ ] Receiver pays a $38.40 customs charge in sandbox; webhook arrives; charge flips to Paid live on screen; hold releases; receiver, sender and admin emailed
- [ ] Two charges on one parcel: paying the first keeps it held, paying the second releases it
- [ ] Abandoning checkout leaves the charge Unpaid and the parcel on hold; Pay works again
- [ ] A replayed webhook (same event id) changes nothing; a webhook with a bad signature or an old timestamp is rejected
- [ ] A forged success URL (`?paid=1`) without a webhook does not mark anything paid
- [ ] Switching to Live requires live key + live webhook secret and shows a confirmation
- [ ] Resend, Stripe and Paystack fields work the same way and "Send test" buttons succeed
