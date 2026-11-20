# ShipWell — LIVE Build Prompt (production, no demo)

Build **ShipWell** as a real, working production website. Attached are screenshots of the approved design: **match them exactly** (layout, spacing, colors, fonts, glass navbar, cards, glows, animations). Everything below must work for real users. **No demo mode, no fake data, no localStorage "database", no "Demo guide" button, no demo logins, no "coming soon" links that do nothing.**

## 0. Bugs to fix first (reported from testing the preview)
1. **Sign Up / Log In buttons, the mobile menu (burger) and all buttons must respond on first tap on phones.** Only footer links worked in the preview. Test on real Android Chrome and iPhone Safari. Use proper `<button>` elements with click handlers; make sure no invisible overlay covers the navbar; do not double-toggle (a tap must not fire twice).
2. **Footer:** remove "Admin Portal" and "Customer Dashboard" links from the footer. Admin is reached only by typing `/admin` (no public link anywhere). Customers reach their dashboard from the account avatar menu in the navbar after login.
3. **Tracking without login:** entering a valid tracking code shows a **summary** (tracking number, status chip, route origin → destination with progress bar, service, weight, estimated delivery, and the **latest update** only: headline, location, time). Below it, a card **"LOG IN FOR MORE UPDATES"** with *Log in* and *Create free account* buttons. The full timeline, item photos, action alerts and parties' details require login. Invalid format → "Check the number"; not found → "No shipment found".
4. Hero badge text is exactly **"Real-time tracking worldwide"**.
5. Tracking codes: always **UPPERCASE**, format `SW-YYYYMMDD-XXXXXXXX` (e.g. `SW-20260531-A8F4B2C1`), even when typed or pasted in lowercase, in every input and in URLs. Regex `^SW-\d{8}-[A-F0-9]{8}$`.

## 1. Tech stack (use exactly this)
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS, deployed on **Vercel** or **Firebase Hosting**. Real routes (no hash routes): `/`, `/ship`, `/quote`, `/business-shipping`, `/track`, `/track/[code]`, `/dashboard`, `/admin`, `/admin/shipments`, `/admin/shipment/[code]`, `/admin/alerts`, `/admin/customers`, `/login`, `/signup`, `/forgot-password`.
- **Firebase project** (production): **Authentication** (email/password; Google sign-in optional), **Cloud Firestore**, **Cloud Storage** (item photos, ID uploads), **Cloud Functions (2nd gen, Node/TypeScript)**, **App Check** (reCAPTCHA Enterprise), **Hosting** optional.
- **Resend** (resend.com) for all transactional email, called **only from Cloud Functions / server code** (the API key is never in the browser). Verify a sending domain in Resend (add SPF, DKIM, DMARC DNS records); send from `ShipWell <notifications@mail.<domain>>`.
- **Payments (duty/shipping fees):** Stripe (Checkout) or Paystack/Flutterwave for African cards. Server-side webhook marks payments paid.
- Environment variables in `.env` / Functions secrets: Firebase web config, `RESEND_API_KEY`, `APP_URL`, `STRIPE_SECRET_KEY` (or Paystack), webhook secrets. Provide `.env.example`. Never commit secrets.

## 2. Design system
Background `#07090F` · card `#0D1117` · border `#1E293B` · accent emerald `#10B981` (light `#34D399`) · text `#F1F5F9` · muted `#94A3B8` · amber `#F59E0B` · red `#F87171` · blue `#60A5FA`. Fonts: **Bebas Neue** (headings, logo, big numbers), **Outfit** (body/UI), **JetBrains Mono** (codes). Glassmorphism fixed navbar (blur + translucent border), 16–20px rounded cards with 1px border and subtle hover lift, floating emerald glows, fade-up hero, reveal-on-scroll, partner logo marquee, animated progress bars. Status chips: small uppercase pills (green/blue/amber/red/grey). **Mobile-first**: nothing may overflow or clip at 360px, hero headline never clips. Logo: emerald rounded square with truck icon + "ShipWell", tagline "TRACK · DELIVER · REPEAT" (hidden on small screens).

## 3. Public pages
**Home:** navbar (logo, links, *Log in* / *Sign up*, or avatar menu when logged in; burger on mobile opening a full drawer with the same links and buttons) → full-height hero (badge, headline `THE WORLD'S GOODS.` / `DELIVERED` in emerald / `WITH PRECISION.`, paragraph, big tracking input + green TRACK button stacked on mobile, helper text "Tracking numbers are always UPPERCASE", trust badges) → "One shipment. Two dashboards." section (sender books & uploads photos → receiver signs up → "On Its Way To You") → quick actions → 6 services cards with numbered labels → How it works (4 steps connected timeline) → stats (200M+ packages, 180+ countries, 99.98% on-time, 24/7 support) → testimonials → business CTA with analytics mockup → partner marquee → footer (Services, Company, Support, Legal, social). **No admin/dashboard links in footer.**
**Quote:** from/to country, weight, value, service → live price (distance-based base + 12% fuel + transit cover + duty/handling international), delivery window; "Ship with this quote" carries values into `/ship`.
**Business Shipping:** benefits, analytics mockup, lead form → saved to Firestore `leads` and emailed to sales via Resend; thank-you state.

## 4. Auth & accounts (real)
- Firebase Auth email/password. Sign up (name, email, password ≥ 8), log in, log out, forgot password (Firebase reset email, branded via Resend if using custom action handler), email verification.
- `users/{uid}`: name, email (lowercase), phone, role (`customer` default), createdAt. **Admin role only via Firebase custom claim `admin: true`**, set by a one-time CLI script (`scripts/make-admin.ts <email>`); never via the public UI.
- Log in / sign up open as a modal on any page (and also exist as `/login`, `/signup`). When opened from a tracking page or booking, show the reason text ("Log in or create a free account to see the full progress of SW-…") and return the user to where they were afterward.
- **Linking rule:** a receiver is linked to a shipment by lowercase email match `shipment.receiver.emailLower == user.emailLower`. After sign-up/login, all matching shipments (including ones booked earlier) appear on their dashboard automatically.

## 5. Ship Now (`/ship`) — 4 steps
1. **Details:** sender (name, phone, address, city, country; email = account email) and receiver (name, phone, **receiver email — required**, address, city, country). Helper: "When the receiver signs up with this email, the parcel appears on their dashboard."
2. **Package:** weight, type, contents, declared value, **item photos 1–4 required** (drag/drop or tap; client-side compress to ≤900px JPEG ~72%; upload to Storage `shipments/{shipmentId}/photos/…`; remove button on thumbnails).
3. **Service:** Standard / Express / Freight with price & ETA.
4. **Review & confirm:** summary, receiver-email status, photos, price breakdown, terms checkbox, payment (Stripe/Paystack) → on success create the shipment.
Login required to confirm (open sign-up modal, then continue without losing the form). Success screen: tracking code (copy button), route, ETA, total, *Track shipment*, *My dashboard*. Server generates the code (`SW-` + date + 8 random hex, unique) inside a Cloud Function — never client-side.

## 6. Tracking (`/track`, `/track/[code]`)
Public callable/HTTP function `trackSummary(code)` returns **only** the limited summary (status, cities/countries, service, weight, ETA, latest event). Full data requires auth and Firestore rules (sender, matching receiver, or admin).
Logged-in full view: code with copy button; status chip; role line ("You are the **recipient** — on its way from {sender}" / "You are the **sender** — waiting for {email} to sign up…"); hold/delay banner; **Action required** banners with *Take action*; animated route bar; meta grid; **item photo gallery** (sender, receiver, admin only; tap to zoom); timeline newest first with a dashed "Next: …" pending stop; distinct dots for scan / delay / action. **Realtime** via Firestore `onSnapshot` so new checkpoints appear instantly.
Progress by stage: Booked 6 · Picked Up 16 · In Transit 42 · At Hub 60 · Customs 74 · Out for Delivery 90 · Delivered 100.

## 7. Customer dashboard (`/dashboard`)
"HELLO, {FIRST NAME}" + *Ship a parcel* button; 4 stat cards (On its way to you · Sent by you · Action required · Delivered); tabs **On Its Way To You** (receiver view: first photo + "N photos", contents, status chip, "From {sender} · City → City", progress bar, code, ETA, service, action strip, *Track live*), **Sent By You** (shows "✓ receiver is on ShipWell" or "Waiting for {email} to sign up"), **Action Required** (open alerts + completed history). Realtime listeners.
**Taking action** modal by alert type: *duty* (pay via Stripe/Paystack), *address* (confirm address), *id* (upload ID to Storage, private), *reschedule* (pick slot), *custom/item* (reply + optional upload). Submitting calls a Cloud Function that resolves the alert, adds a timeline event, **releases the hold if the alert was linked to it**, and emails the admin.

## 8. Admin panel (`/admin/*`, admin claim required, server-enforced)
Own layout (no public navbar/footer): left sidebar (logo "ShipWell / Operations", Overview, Shipments [badge = awaiting review], Receiver actions [badge = open], Customers, user card, Sign out); on mobile the sidebar becomes a scrolling tab bar. Sign-in page at `/admin`.
- **Overview:** 6 KPIs (Total, In transit, Awaiting review, Delayed/on hold, Open receiver actions, Delivered); *Needs attention* queue; shipments-by-stage bars; recent activity feed.
- **Shipments:** live search (code, names, emails, contents) + filter (All / Awaiting review / In transit / Delayed-on hold / Delivered), paginated.
- **Shipment detail:** (1) **Review item** — photos (zoom), Approve / Flag issue (reason → alert to sender + hold linked to alert). (2) **Add checkpoint** — stage, headline, location (autocomplete), note, date-time → appended live, status updated. (3) **Next stop & ETA.** (4) **Delay / On hold** with reason (banner for customers) + Clear. (5) **Ask receiver or sender to act** — templates (Pay import duty, Confirm address, Upload ID, Reschedule, Custom), editable title/message, optional amount, "Hold until resolved"; creates in-app alert + sends email. (6) **Parties** — "✓ signed up" or "waiting for sign-up", *Send invite* (resend email) and invite history. (7) **Timeline** with Undo last. All admin writes go through Cloud Functions that validate the admin claim and write an **audit log**.
- **Receiver actions:** all alerts (Open / Resolved / All) with responses. **Customers:** registered users with sent/receiving counts + "Receivers not signed up yet" list with *Send invite*.

## 9. Firestore data model
`users` · `shipments` {code, codeUpper, createdAt, senderUid, sender{…}, receiver{name,email,emailLower,phone,address,city,country}, service, weightKg, packageType, contents, declaredValue, total, paymentStatus, status, hold{type,reason,at,alertId}|null, eta, nextStop|null, review{state,note,at,by}} with subcollections `events` {ts,stage,label,location,note,kind,by}, `alerts` {to,kind,title,message,amount,status,createdAt,resolvedAt,response,attachments}, `photos` {path,uploadedAt} · `invites` {shipmentId,emailLower,tokenHash,status,sentAt,openedAt,count} · `leads` · `auditLog` · `mailLog` {to,template,status,providerId,at}. Index on `receiver.emailLower`, `senderUid`, `code`.

## 10. Security rules (must be written and tested)
- Firestore: users read/write only own doc; `shipments` read allowed if `request.auth.uid == senderUid` **or** `request.auth.token.email.lower() == receiver.emailLower` **or** admin claim; **no client writes to shipments/events/alerts** except through callable functions (alert response via function). Public tracking only via the `trackSummary` function.
- Storage: photos readable only by sender/receiver/admin (use rules that check the parent shipment doc, or short-lived signed URLs from a function); uploads by sender only, `image/*`, ≤5 MB, max 4; strip EXIF. ID uploads private to admin + owner.
- App Check on all callable functions; rate-limit `trackSummary` and invite sending; validate/sanitise every input; HTTPS only; secure headers/CSP.

## 11. Emails via Resend (Cloud Functions + React Email or plain HTML)
Shared components: ShipWell logo header, bold heading, short copy, one big emerald button, copy-link fallback line, muted footer. Dark-mode-safe, table-based, 360px tested; plain-text version for each.
1. **Receiver invite** (receiver has no account) — sent **immediately when the booking is confirmed**. Subject: `{Sender first name} is sending you a parcel — track it on ShipWell`. Heading: **A parcel is on its way to you**. Copy: `Hello {Receiver first name}. {Sender full name} has shipped {contents} to you from {origin city}, {origin country}. Your tracking number is {SW-…} · Estimated delivery {date}. ShipWell is the live tracking platform for this shipment — every checkpoint, delay and delivery update, plus the photos {Sender first name} uploaded of the item, appear on your dashboard. Create your free account to see it.` Button **Create my account** → `{APP_URL}/track/{CODE}?invite={token}`. Then `Or copy this link into your browser:` + full URL. Then `Use **{receiver email}** and your parcel finds you. Already made an account? **Sign in**.` Footer: `You are getting this because {Sender full name} entered your email when booking a ShipWell shipment. Questions? Reply to this email.` + "I don't know this sender" link. **No photos, addresses, prices or phone numbers in the email.**
2. **"On its way" email** (receiver already has an account): same design, button **Track my parcel**.
3. **Reminders** to unregistered receivers at 48 h and 5 days (max 3 total; stop on sign-up) via scheduled function.
4. **Sender confirmation:** code, route, ETA, total, "We've emailed {receiver name} at {email}".
5. Checkpoint / delay-hold / **action required** (deep link to dashboard) / action resolved (to admin) / delivered / password reset / lead notification to sales.
**Invite link behavior:** `invite` token = random, 30-day expiry, stored hashed, tied to shipment + email. Opening it signed-out shows the tracking summary with the sign-up form open, **email prefilled and locked**; after sign-up the email is marked verified, the user lands on the full tracking page and the parcel shows under *On Its Way To You* with the sender's photos. Logging in with a different email shows "This parcel was sent to e*****n@gmail.com. Sign in with that email to see it." Expired token → request a new link. Admin *Send invite* resends and logs the history.

## 12. Cloud Functions list
`createShipment` (validate, price server-side, generate code, write docs, trigger emails) · `trackSummary` (public, limited) · `trackFull` or direct rules-protected reads · `resolveAlert` · admin callables: `approveItem`, `flagItem`, `addCheckpoint`, `setNextStop`, `setHold`, `clearHold`, `createAlert`, `undoLastEvent`, `sendInvite` · `onUserCreate` (link, mark verified if invite token) · `scheduledReminders` · `stripeWebhook` · `submitLead` · all emails go through one `sendMail(template, data)` helper that writes `mailLog`.

## 13. Quality, deployment & handover
Accessibility (focus states, aria labels, reduced-motion), SEO meta for public pages, lazy-loaded images, fast LCP, error/empty/loading states on every screen, toasts. Write unit tests for pricing, code format, linking rule, and rules-emulator tests for Firestore/Storage security. Provide: setup README (Firebase project, enabling Auth/Firestore/Storage, deploying rules & functions, Resend domain verification, env vars, creating the first admin, Stripe/Paystack keys), staging + production environments, and a seed script for **staging only**.

## 14. Acceptance checklist
- [ ] Sign up, Log in, burger menu, and every button work on first tap on a real phone; footer has no Admin/Dashboard links.
- [ ] Hero badge reads exactly "Real-time tracking worldwide"; codes always uppercase (typed, pasted, URL).
- [ ] Logged-out tracking shows the summary + "Log in for more updates"; logged-in shows the full timeline, photos and actions.
- [ ] Sender books with receiver email + photos → receiver gets the invite email within a minute (matching the reference email screenshots) → signs up with that email → sees the parcel under "On Its Way To You" with photos.
- [ ] Admin (claim-protected) can approve/flag, add checkpoints, set next stop/ETA, flag delay/hold, alert the receiver; customer sees it live and gets an email.
- [ ] Receiver completes an action → hold released, timeline updated, admin notified.
- [ ] Non-admins get 403 on admin functions/routes; unrelated users cannot read photos or shipments.
- [ ] Emails pass SPF/DKIM/DMARC and render in Gmail dark mode on mobile.
