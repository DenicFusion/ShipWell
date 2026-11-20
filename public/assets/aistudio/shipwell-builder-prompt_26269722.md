# ShipWell — Complete Builder Prompt

You are building **ShipWell**, a luxury logistics platform, as a real production website. I'm attaching screenshots of the approved demo (`index.html`). **Match the design in the screenshots exactly** — layout, spacing, colors, typography, glass navbar, cards, glows, and animations. The demo stores everything in the browser; your job is to make every behavior below real, with a proper backend.

---

## 1. Brand & Design System

| Token | Value |
|---|---|
| Background | `#07090F` |
| Card | `#0D1117` |
| Border | `#1E293B` |
| Accent (emerald) | `#10B981` (hover/light `#34D399`) |
| Text | `#F1F5F9` |
| Muted | `#94A3B8` |
| Amber (warnings/pending) | `#F59E0B` |
| Red (holds/errors) | `#F87171` |
| Blue (info/waiting) | `#60A5FA` |

- **Fonts:** Bebas Neue (all headings, big numbers, logo), Outfit (body/UI), JetBrains Mono (tracking codes, IDs).
- **Look:** dark luxury, Stripe/Linear/DHL-premium. Glassmorphism fixed navbar (blur + translucent border). Cards with 1px `#1E293B` border, 16–20px radius, subtle hover lift. Emerald glow backgrounds floating slowly behind hero. Status "chips" are small uppercase pills (green / blue / amber / red / grey).
- **Mobile-first.** Most review happens on phones. Nothing may overflow or clip at 360px width. Hero headline must never clip.
- **Animations:** fade-up on hero, reveal-on-scroll, floating glows, marquee of partner logos, progress bars that animate in, button hover transitions.
- **Logo:** emerald rounded square with a truck icon + "ShipWell" in Bebas Neue, tagline "TRACK · DELIVER · REPEAT" (hidden on small screens).

## 2. Pages & Routes (real URLs, not hash routes)

| Route | Purpose |
|---|---|
| `/` | Home |
| `/ship` | Ship Now — 4-step booking wizard |
| `/quote` | Instant quote calculator |
| `/business-shipping` | Business accounts lead page |
| `/track` and `/track/:code` | Tracking |
| `/dashboard` | Customer dashboard (sender + receiver) |
| `/admin`, `/admin/shipments`, `/admin/shipment/:code`, `/admin/alerts`, `/admin/customers` | Admin panel |

### 2.1 Home
Sections in order: fixed navbar → full-height hero → "One shipment. Two dashboards." explainer → quick actions (Ship Now, Get a Quote, Business Shipping) → services grid (6 cards with numbered labels) → how it works (Book Online, We Collect, We Ship, Delivered — connected timeline) → stats bar (200M+ packages, 180+ countries, 99.98% on-time, 24/7 support) → testimonials (3, five-star) → business CTA with analytics mockup → partner logo marquee → footer (Services, Company, Support, Legal, social icons; Company includes "Admin Portal").

**Hero:** badge reads exactly **"Real-time tracking worldwide"**. Headline: `THE WORLD'S GOODS.` / `DELIVERED` (emerald) / `WITH PRECISION.` Supporting paragraph, large tracking input + green TRACK button, trust badges (SSL encryption, 24/7 live support, etc.). On mobile the tracking input and button stack.

### 2.2 Tracking code format (strict)
`SW-YYYYMMDD-XXXXXXXX` e.g. `SW-20260531-A8F4B2C1` — "SW", 8-digit date, 8 hex characters. **Always uppercase.** Anything typed or pasted in lowercase is converted to uppercase instantly in every tracking input, and the URL is normalized to uppercase. Validate with `^SW-\d{8}-[A-F0-9]{8}$`. Generate server-side with a cryptographically random suffix, guaranteed unique.

### 2.3 Quote (`/quote`)
From/to country, weight, declared value, service (Standard, Express, Freight). Live price: base (distance-based) + 12% fuel + transit cover + duty/handling for international. Show estimated delivery window in business days. "Ship with this quote" button carries values into `/ship`.

### 2.4 Ship Now (`/ship`)
Four steps with progress indicator and live price summary:
1. **Details** — sender (name, phone, email, address, city, country) and receiver (name, phone, **receiver email — required**, address, city, country). Helper text under receiver email: "When the receiver signs up with this email, the parcel appears on their dashboard."
2. **Package** — weight, type, contents description, declared value, **item photos (1–4 required)**. Drag-drop / tap-to-upload, thumbnails with remove button. Compress client-side (max 900px, JPEG ~72%) before upload.
3. **Service** — Standard / Express / Freight cards with price & ETA.
4. **Review & confirm** — summary incl. receiver email status ("Already on ShipWell" vs "Will see it once they sign up"), photos, price breakdown, terms checkbox.

Confirming requires an account: if not logged in, open the sign-up modal (prefilled), then complete the booking. After booking: success screen with tracking code (copy button), route, ETA, total, "Track Shipment" and "My dashboard" buttons. A new shipment is created with **review state = pending** and a first event "Booking received".

### 2.5 Business Shipping
Hero, benefits list (volume pricing, dedicated manager, API, consolidated invoicing), analytics mockup, and a lead form (company, name, email, plan, monthly volume, message) → stored as a lead and emailed to sales; thank-you state.

## 3. Accounts & Auth

- Sign up (name, email, password ≥ 6 chars — use ≥ 8 in production), log in, log out, forgot password (emailed reset link), account menu (avatar with initials, notification dot when actions are open).
- Single user type for customers (a user can be both sender and receiver). A separate `admin` role.
- Passwords hashed (argon2/bcrypt). Sessions via secure httpOnly cookies. Email verification recommended.
- **Linking rule:** a receiver is linked to a shipment purely by lowercase email match. Whenever a user registers/logs in, all shipments whose `receiver.email` equals their email appear in their dashboard — including ones booked before they signed up.
- Admin accounts are created by seed/CLI only, never by public sign-up. Admin routes are role-protected on the server.

## 4. Tracking Gate (important)

1. Anyone can enter a tracking code on the home hero or `/track`.
2. Invalid format → "Check the number". Valid format but not found → "No shipment found".
3. Found, **user not logged in** → show the header, route bar and a blurred timeline with an overlay: **"Sign up to see live progress"** with *Create free account* and *Log in* buttons (modal says "Create a free account to see the live progress of SW-…"). After auth, the page reloads straight to the full view.
4. Logged in → full tracking view: tracking code with copy button, status chip, a line identifying the viewer's role ("You are the **recipient** — this parcel is on its way to you from …" / "You are the **sender** — waiting for … to sign up…" / Admin view with link), hold/delay banner, **action-required banners** with a "Take action" button, animated route bar (origin → destination with plane marker), meta grid (service, weight, contents, ETA / revised ETA), **item photo gallery** (only sender, receiver and admin; others see "Photos are only visible to the sender and the receiver"), and the timeline (newest first, optional dashed "Next: …" pending stop, distinct dots for scans, delays, actions).
5. Live updates: push via WebSocket/SSE (or poll every 30–60 s) so a new checkpoint appears without refresh.

Progress percentages by stage: Booked 6 · Picked Up 16 · In Transit 42 · At Hub 60 · Customs 74 · Out for Delivery 90 · Delivered 100.

## 5. Customer Dashboard (`/dashboard`)

Header "HELLO, {FIRSTNAME}" + "Ship a parcel" button. Four stat cards: On its way to you · Sent by you · Action required (red when > 0) · Delivered. Three tabs:

- **On Its Way To You** — parcels where `receiver.email` = my email. Card: first item photo (+ "N photos" badge), contents, status chip, "From {sender} · City → City", progress bar (amber when held), tracking code, ETA, service, an action strip if any alert is open ("Take action →"), and "Track live →". Empty state explains that parcels sent to this email appear automatically.
- **Sent By You** — shipments I booked; shows "✓ receiver is on ShipWell" or "Waiting for {email} to sign up".
- **Action Required** — open alerts as cards (icon by type, title, message, amount, shipment ref, "Take action"), then a "Completed" history.

**Taking action** opens a modal depending on alert type: *duty* (pay amount — real payment gateway in production), *address* (confirm full address), *id* (upload ID image), *reschedule* (pick a new slot), *custom/item* (reply/upload). Submitting marks the alert resolved, stores the response, adds a timeline event ("Action completed by receiver"), and **releases the hold automatically if the alert was linked to it**. Admin is notified.

## 6. Admin Panel (`/admin/*`)

Separate layout without the public navbar/footer: left sidebar (logo "ShipWell / Operations", nav, user card, "View website", Sign out) — on mobile the sidebar becomes a horizontally scrolling tab bar. Admin sign-in page (email + password).

**Nav:** Overview · Shipments (badge = awaiting review) · Receiver actions (badge = open alerts) · Customers.

1. **Overview** — 6 KPI cards (Total, In transit, Awaiting review, Delayed/on hold, Open receiver actions, Delivered); **Needs attention** queue (items to review, holds/delays, parcels waiting on a customer — each links to the shipment); Shipments-by-stage bar chart; Recent activity feed.
2. **Shipments** — live search (code, names, emails, contents) + status filter (All, Awaiting review, In transit, Delayed/on hold, Delivered); rows show code, route, sender → receiver (+ "not signed up"), status chip, ETA, item review state. Pagination in production.
3. **Shipment detail** (the core screen), in this order:
   1. **Review the item** — shows the sender's photos (click to zoom), contents, type; buttons **Approve item** (adds "Item reviewed and approved") and **Flag an issue** (asks for a reason → creates an alert to the sender, puts shipment on hold linked to that alert, adds a delay event).
   2. **Add a checkpoint** — stage (Booked → Delivered), headline, location (autocomplete), optional note to customer, date/time. Saving appends to the timeline, updates the shipment status, and pushes it live to customers. Step-by-step location updates are the main workflow.
   3. **Next stop & ETA** — label, location, expected time, delivery ETA. Shows as "Next:" on the customer timeline.
   4. **Delay or hold** — type (Delayed / On Hold) + reason shown on the customer's banner; "Clear" button releases it.
   5. **Ask the receiver (or sender) to act** — templates: Pay import duty, Confirm address, Upload ID, Reschedule delivery, Custom; editable title/message; optional amount; checkbox "Hold shipment until resolved". Sends an in-app alert + email/SMS to that person. History of alerts with Open/Resolved state and the customer's response.
   6. **Parties** — sender & receiver details with "✓ signed up" or "waiting for sign-up" and a *Send invite email* button for unregistered receivers.
   7. **Timeline** with *Undo last*.
4. **Receiver actions** — all alerts, tabs Open / Resolved / All, to whom, shipment, status, response; click opens the shipment.
5. **Customers** — registered users with sent/receiving counts; a second list of **receivers who haven't signed up yet** (email + number of parcels waiting) with *Send invite*.

All admin actions are audit-logged (who, what, when).

## 7. Data Model

- **users**: id, name, email (unique, lowercase), phone, password_hash, role (`customer`|`admin`), created_at, email_verified.
- **shipments**: id, code (unique), created_at, sender_id, sender{name,email,phone,address,city,country}, receiver{name,email,phone,address,city,country}, service, weight_kg, package_type, contents, declared_value, price_total, status, hold{type,reason,at,alert_id}|null, eta, next_stop{label,loc,eta}|null, review{state `pending|approved|flagged`, note, at, by}.
- **shipment_photos**: id, shipment_id, storage_key, uploaded_at.
- **events**: id, shipment_id, ts, stage, label, location, note, kind (`scan|delay|action|review|info`), created_by.
- **alerts**: id, shipment_id, to (`receiver|sender`), kind (`duty|address|id|reschedule|custom|item`), title, message, amount, status (`open|resolved`), created_at, resolved_at, response (JSON), attachments.
- **leads** (business form), **audit_log**, **password_resets**, **notifications**.

## 8. API (suggested REST)

`POST /auth/signup|login|logout|forgot|reset` · `GET /me` · `POST /shipments` (multipart with photos) · `GET /shipments/mine?role=sender|receiver` · `GET /track/:code` (returns teaser if anonymous, full payload if authenticated and authorised) · `GET /shipments/:code/photos/:id` (signed URL, only sender/receiver/admin) · `POST /alerts/:id/resolve` · admin: `GET /admin/overview`, `GET /admin/shipments?q=&status=`, `POST /admin/shipments/:code/approve|flag|events|next-stop|hold|clear-hold|alerts`, `DELETE /admin/shipments/:code/events/last`, `GET /admin/alerts`, `GET /admin/customers`, `POST /admin/invites`. Pricing endpoint `POST /quote`.

## 9. Notifications

Email (transactional): welcome, booking confirmation with tracking code, **"A parcel is on its way to you"** to the receiver (with sign-up link prefilled with their email — sent at booking), new checkpoint (optional), delay/hold notice, **action required** (with deep link to the dashboard), action resolved (to admin), password reset. SMS/WhatsApp optional later. In-app: bell/notification dot on avatar and the Action Required tab.

## 10. Security & Quality

- Role-based access on every endpoint; receivers only see shipments matching their email; senders only theirs; admin all.
- Photos in private object storage (S3/R2), served by short-lived signed URLs; validate type/size (≤ 5 MB each, 4 max), strip EXIF.
- Rate-limit auth and tracking lookups; CSRF protection; input sanitisation; HTTPS only; secure headers.
- Never reveal whether a tracking code belongs to someone beyond what the gate allows.
- Accessibility: focus states, aria labels, `prefers-reduced-motion`.
- Performance: lazy-load images, fast LCP, SEO meta for public pages.

## 11. Demo → Production Notes

The demo uses localStorage and hash URLs (`#/ship`); replace with real routes. Demo logins (remove in production): customer `demo@shipwell.com` / `demo1234`, admin `admin@shipwell.com` / `Admin@123`. The floating "Demo guide" button and demo-data labels must be removed. The seven seeded sample shipments are only for demonstration — they show every state (booked/awaiting review, in transit, at hub delayed, customs with duty alert, on hold with ID alert, out for delivery, delivered).

## 12. Acceptance Checklist

- [ ] Visual match with screenshots at 360, 768, 1280 px; no horizontal scroll; hero never clips.
- [ ] Hero badge text is exactly "Real-time tracking worldwide".
- [ ] Tracking codes always uppercase (typed, pasted, in URL).
- [ ] Anonymous tracking shows the sign-up gate; after sign-up the full timeline appears.
- [ ] Sender books with receiver email + photos; receiver signs up with that email and immediately sees the parcel under "On Its Way To You" with the sender's photos.
- [ ] Admin can approve/flag the item, add checkpoints, set next stop/ETA, flag delay/hold, alert receiver/sender; the customer sees each change live.
- [ ] Receiver completes an action → hold is released, timeline updated, admin sees it resolved.
- [ ] Non-admins get 403 on all admin routes; photos are inaccessible to unrelated users.
- [ ] All emails above are delivered with working deep links.
