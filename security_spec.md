# ShipWell Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. Tracking codes strictly conform to `^SW-\d{8}-[A-F0-9]{8}$` (always uppercase).
2. `users/{uid}` contains PII and has no client-writable `role` or `isAdmin` field; only the owner (`request.auth.uid == uid`) or verified admin can read/write it.
3. `shipments/{code}` contains PII and sender photos (`photos.size() <= 4`); only the sender (`senderId == request.auth.uid`), verified receiver (`request.auth.token.email_verified == true && receiverEmail == request.auth.token.email.lower()`), or admin may read it.
4. `trackingTeasers/{code}` stores only non-PII route/status summary for the public tracking gate (no `list` allowed).
5. `accountStatus/{emailHash}` stores only `{ exists: true, updatedAt }` keyed by SHA-256 of lowercase email (no `list` allowed).
6. Subcollections `events`, `alerts`, `invites` inherit access via `get(/databases/$(database)/documents/shipments/$(code))` (Master Gate).
7. Alerts may only be resolved by the designated target (`receiver` or `sender`) or admin, modifying only `status`, `resolvedAt`, `response`, and `attachmentName`.
8. Only admins (`admins/{uid}` or `request.auth.token.email == 'denic9426@gmail.com' && request.auth.token.email_verified == true`) can approve/flag reviews, append checkpoints, set nextStop, manage holds, list all shipments, read business leads, or write `auditLogs`.
9. Every `create` and `update` validates exact keys (`hasAll` + `hasOnly` / `affectedKeys().hasOnly(...)`) and enforces `request.time` on `createdAt`/`updatedAt`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Self-Admin Escalation**: `create users/{uid}` with `{ uid, name, email, role: 'admin' }` -> Denied by `hasOnly`.
2. **Unverified Email Spoofing Admin**: Read `leads` with `email: 'denic9426@gmail.com'`, `email_verified: false` -> Denied by `email_verified == true`.
3. **Unverified Receiver Spoofing**: `get shipments/SW-...` where `receiverEmail == auth.token.email` but `email_verified == false` -> Denied.
4. **PII Leak via List**: `list users` or `list shipments` as non-admin without owner/receiver constraint -> Denied.
5. **Photo & PII Leak to Third Party**: Authenticated stranger calls `get shipments/SW-20261116-A8F4B2C1` -> Denied.
6. **Ghost Field Injection (Shadow Update)**: `update shipments/{code}` adding `{ isVerified: true }` -> Denied by `affectedKeys().hasOnly(...)`.
7. **Terminal State Bypass**: Non-admin attempting to update a `Delivered` shipment -> Denied.
8. **ID Poisoning**: Creating `shipments/../../etc` or 1.5KB doc ID -> Denied by `isValidTrackingCode()` / `isValidId()`.
9. **Unbounded Photos Array**: Booking shipment with `photos` length 5 -> Denied by `photos.size() >= 1 && photos.size() <= 4`.
10. **Sender Tampering with Review/Hold**: Sender updating `review.state = 'approved'` on their own shipment -> Denied by `affectedKeys().hasOnly(...)`.
11. **Receiver Modifying Shipment Price or Receiver Email**: Receiver updating `priceTotal` or `receiverEmail` during alert resolution -> Denied.
12. **Client Timestamp Forgery**: Creating `leads/{id}` with backdated `createdAt` (`!= request.time`) -> Denied.
