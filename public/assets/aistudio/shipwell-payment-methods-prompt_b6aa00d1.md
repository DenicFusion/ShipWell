ADD: ADMIN-MANAGED PAYMENT METHODS (automatic and manual). Keep my current design. Do not change other pages.

GOAL
Admin controls every way a customer can pay, from Admin > Settings > Payment methods. Admin can add as many methods as needed (bank transfer, crypto, mobile money, cash, anything), edit or turn them off at any time, and customers choose from the enabled ones at checkout. Nothing about payment options is hardcoded.

1. ONE LIST OF METHODS (replace the fixed "Pay now / Pay on delivery" buttons)
All payment options become records in Firestore `paymentMethods/{id}`. Seed these on first run (admin can edit, disable or delete any of them):
- Card / bank (Bachs): automatic. Uses the Bachs keys already saved in Admin > Settings. Shown only when Bachs is configured and enabled.
- Pay on pickup / delivery: manual, no proof needed.
- One example Bank transfer and one example Crypto method (disabled by default, with sample fields).
Stripe and Paystack, if enabled in Settings, also appear here as automatic methods.

2. ADMIN: ADD / EDIT A METHOD (a form in the ShipWell admin look, mobile friendly)
Fields:
- Name (e.g. "Bank transfer (USD)"), short description shown to customers, icon or logo upload (or choose an icon), enabled toggle, display order (drag to reorder).
- Type: Automatic gateway, Bank transfer, Crypto, Mobile money, Cash (pickup/delivery), Other (custom).
- Details to show the customer: add any number of rows of label + value, each with a Copy button for the customer (e.g. Bank name, Account name, Account number, IBAN, SWIFT, Sort code, Wallet address, Network, Memo/Tag, Mobile money number). Optional QR code image upload.
- Instructions text (multi-line). Placeholders filled automatically: {amount}, {currency}, {reference}, {trackingCode}, {name}.
- Currency, and an optional fixed exchange rate if this method is in a different currency (e.g. crypto or local currency), so the customer sees the exact amount to send.
- Optional fee or discount for this method (fixed or percent). The server adds it to the total.
- Rules: minimum and maximum order amount, available countries (all or a list), available for (shipping, customs charges, or both), who can use it (everyone, or business accounts only).
- Proof settings: require proof of payment (yes/no), what to ask (screenshot upload, transaction ID / hash, sender name, date paid), and approval mode: Manual review by admin (default) or Auto-approve (only for cash on pickup/delivery).
- Payment window: how long the customer has to pay before the booking expires (default 24 hours for manual, 60 minutes for automatic).
- Test it: a "Preview as customer" button showing exactly how it looks at checkout.
Admin can duplicate, disable or delete a method. A method with past payments can only be disabled (history is kept).

3. CUSTOMER CHECKOUT (Ship step 4 and customs charge payment)
- Show every enabled method that fits the order (country, amount, type) as selectable cards, in the admin's order, with icon, name and description. The total updates if the method has a fee. If no method is available, show "No payment method available, contact support" with the support email.
- Automatic method (Bachs/Stripe/Paystack): works as already specified, overlay checkout, webhook marks it paid.
- Manual method: after Confirm, the booking is created as `awaiting_payment` with a server-generated payment reference (like SW-PAY-7K2Q9X). Show a "How to pay" screen: exact amount (and converted amount if a rate is set), the details rows with Copy buttons, the QR code, the instructions, the reference to include, and a countdown to the payment window. Then the customer taps "I have paid" and submits the proof (upload screenshot or PDF, transaction ID, sender name, date). Status becomes "Payment under review". They can leave and come back: it shows under Sent and Drafts as "Awaiting payment" or "Under review" with a Continue button.
- Cash on pickup/delivery: no proof, booking is confirmed immediately as "Payment due on pickup/delivery".
- All states are visible to the customer: Awaiting payment, Under review, Paid, Rejected (with the admin's reason and a button to re-submit), Expired.

4. ADMIN: PAYMENTS QUEUE (Admin > Payments)
- List of all payments with filters (Awaiting, Under review, Paid, Rejected, Expired, Refunded), method, date range and search by reference, tracking code or email. KPI strip: pending review count, paid today, total received.
- Open a payment: booking summary, amount expected, method, reference, the customer's proof (image/PDF viewer, transaction ID), history.
- Actions: Approve (booking becomes Paid and is released for dispatch), Reject (required reason, customer can re-submit), Request more info, Mark as received manually (for cash), Refund (record), Extend the payment window.
- Warn when the same transaction ID or proof file was used on another payment (duplicate detection).
- Every action is saved to an audit log (who, what, when) visible to admin.
- Admin gets a bell notification and an email when new proof is submitted.

5. EMAILS (from payments@mail.shipwell.cc, Reply-To support@mail.shipwell.cc)
- Payment instructions sent to the customer after booking (with the same details and reference).
- Proof received.
- Payment approved with receipt (booking number, amount, method, date, tracking code).
- Payment rejected with the reason and a link to re-submit.
- Reminder before the payment window ends, and an expiry notice.
- Admin notification when proof is submitted.
All follow the ShipWell email look and the customer's notification settings.

6. SECURITY AND RULES
- The total is always calculated on the server, including the method's fee and any exchange rate. Never trust amounts from the browser. The payment reference is generated on the server.
- Only admin (custom claim `admin: true`) can create or edit `paymentMethods`; customers can read only enabled methods. Payment details shown to customers are meant to be public, but never store gateway secret keys in this collection (those stay encrypted in `adminSecrets`).
- Proof files go to Storage under `paymentProofs/{uid}/{paymentId}/`, readable only by the owner and admin. Allow images and PDF only, max 10 MB, scan the type on the server, and strip nothing else. Customers cannot edit a proof after it is approved.
- A booking is never dispatched or marked Paid until an automatic webhook confirms it or an admin approves it (or it is cash on pickup/delivery).
- Rate limit proof uploads. Show clear errors. The spinner must never hang.
- Works the same for booking payments and customs charges, both themes, no horizontal scroll at 360px.

7. DATA (suggested)
`paymentMethods/{id}`: name, type, description, icon, enabled, order, details[{label,value}], qrUrl, instructions, currency, rate, fee{type,value}, rules{min,max,countries[],appliesTo[],audience}, proof{required,fields[],approval}, windowMinutes.
`payments/{id}`: bookingId or chargeId, uid, methodId, methodSnapshot (copy of details at that time), amount, currency, reference, status, proof{files[],txId,senderName,paidAt}, review{by,at,reason}, createdAt, expiresAt.

ACCEPTANCE
- [ ] Admin adds a Bank transfer method with 5 detail rows, a QR image and instructions; it appears at checkout immediately
- [ ] Admin adds a Crypto method with a rate; the customer sees the exact amount to send
- [ ] Disabling a method hides it at checkout; reordering changes the order
- [ ] Customer picks a manual method, sees details with Copy buttons, uploads proof, status becomes Under review
- [ ] Admin approves: booking becomes Paid, receipt email sent. Admin rejects with a reason: customer is told and can re-submit
- [ ] Unpaid manual payment expires after its window and the booking is cancelled with no dispatch
- [ ] Changing the price or fee in the browser console changes nothing
- [ ] Bachs checkout still works as one of the methods
- [ ] Same flow works for customs charges
