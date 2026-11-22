# ShipWell — v4 Update Prompt (send with the attached `index.html` and screenshots)

The attached `index.html` is the **visual and behavioral source of truth**. Open it in a browser first and use it. Copy its CSS tokens, layout and components exactly; make everything below **live** (Firebase + Resend + Stripe/Paystack). Domain: **shipwell.cc**. Do not rebuild from scratch; update the existing project.

---

## 1. Fix what is broken on the live site (from my screenshots)

1. **Tall green block and sideways page shift on `/ship` and `/quote`.** Cause: the hero glow classes `.g1/.g2/.g3` collide with the form grid classes `.g2/.g3`. Rename the glow classes to `.gl1/.gl2/.gl3` (see my file) and add `overflow-x: clip` on `html, body`. Test at 360px, 390px and 768px: no horizontal scroll on any page.
2. **Stats row** (200M+, 180+, 99.98%, 24/7): all four numbers must use the same style as the big green "24/7": Bebas Neue, `clamp(2.6rem, 5vw, 4rem)`, colour `var(--em)`, soft glow. Render the final value in the HTML itself (so it shows even if the counter animation fails), and animate on scroll only as an enhancement. No small grey numbers.
3. **Quote page:** the calculator must return a price. Copy the logic and layout from my file (origin, destination, weight, declared value, pickup date, three service tiers with price and ETA, live recalculation on every change, tiers stack cleanly on mobile, "Ship this" button goes to `/ship` with values carried over). Fix whatever currently stops it from showing results.
4. Hero badge reads exactly **"Real-time tracking worldwide"**. Tracking codes always uppercase (`SW-20260531-A8F4B2C1`).

## 2. Dark and light theme (nothing left out)

**Default = the visitor's device theme.** First visit (guests and signed-in users with no saved choice): read `prefers-color-scheme`. If the phone or computer is in light mode, open the site in **light**; if it is in dark mode, open in **dark**. The theme also follows the device live: if the phone switches between light and dark while the site is open (and the user has not chosen manually), the site switches with it.

- Three choices: **System (default), Dark, Light**. A manual choice overrides the device and is saved: `localStorage` key `sw_theme` for guests, and `users/{uid}.theme` in Firestore for signed-in users so it follows them across devices. Choosing System removes the override.
- Implement with CSS variables and `data-theme="dark|light"` on `<html>`, resolved from the saved choice or from `prefers-color-scheme`. Copy the exact token sets from the `:root` and `:root[data-theme=light]` blocks in my file. **No hard-coded colours anywhere**; use `rgb(var(--em-rgb) / .14)` style tokens for translucent colours.
- Add a tiny inline script in `<head>` that sets `data-theme` before first paint (no flash of the wrong theme). Update `<meta name="theme-color">` (browser bar colour) and `color-scheme` when the theme changes. Smooth 300ms colour transition when switching.

**Where the switch lives (NOT in the top bar of the homepage):**
- **Website:** no theme button in the top navbar. Put it **inside the menu**: in the mobile burger menu (bottom of the drawer, a 3-option control Dark / Light / System), and on desktop inside the account/menu dropdown (for guests, a small menu next to the burger or in the footer-adjacent "Appearance" control). The top bar of the homepage stays clean: logo, links, Log In / Sign Up.
- **Dashboard:** no theme button in the dashboard top bar. It lives in **Account → Appearance** (the user's profile settings) as the 3-way selector, and also inside the dashboard menu / avatar menu as a compact Appearance row.
- **Admin:** inside the admin sidebar menu (bottom, above Sign out) and in Settings.
- The control shows which option is active, applies instantly, and works with one tap on phones.

Every screen must be checked in both themes: home, services, how it works, quote, ship wizard, track, auth modal, dashboard (all pages), admin (all pages), modals, toasts, email previews, empty states, route map SVG, photo gallery, charts and chips. Text contrast at least WCAG AA in both.

## 3. "Ship Now" requires login

- Every "Ship Now" / "Ship a parcel" button and the `/ship` route: if the user is **not signed in**, open the login modal (Log in / Sign up tabs) with the message "Log in or create a free account to ship a parcel. Your tracking number and the receiver link are kept on your account." After login or signup, continue straight to `/ship`.
- Direct visits to `/ship` (typed URL, refresh) do the same. Enforce on the server too: the booking Cloud Function rejects unauthenticated calls.

## 4. Customs charges: admin can add them again and again

In Admin → Shipment, add the card **"Customs & duty charges"** (see my file):
- Ledger of every charge on the shipment: type, amount, note, time, **Paid / Unpaid** chip, totals for Paid and Outstanding.
- Form: charge type (Import duty, VAT/GST, Customs handling fee, Inspection fee, Storage fee, Other), amount (USD), note to receiver, checkbox **"Hold the parcel until this is paid"** (on by default).
- **Admin can add as many as needed.** Each new charge: creates an action request for the receiver, moves the status to *Customs* if it is earlier, adds a timeline event, **puts the parcel back on hold automatically**, and emails the receiver (see section 5).
- Receiver sees a **"Duties & charges"** card in the dashboard tracker with each charge and a **Pay** button (Stripe or Paystack Checkout), plus the red "Action required" banner and badge count.
- Hold logic: a parcel stays on hold while **any** hold-charge is unpaid. Paying one charge while another is open keeps the hold (timeline: "Still on hold, another action is pending"). When the **last** one is paid, the hold is released automatically, the timeline says "Hold released", and the receiver and sender get an email. Payment is confirmed only by the **Stripe/Paystack webhook** on the server, never by the browser.
- Admin is notified (email to support + in-app) when the receiver pays.

## 5. Email: Resend on the subdomain `info.shipwell.cc`

Resend requires a **subdomain**, so we send from `info.shipwell.cc`, not the root domain.
1. In Resend → Domains → add **`info.shipwell.cc`**. Add the DNS records Resend shows (SPF, DKIM, and the MX/return-path record for that subdomain) at the DNS host for shipwell.cc. Add a DMARC record `_dmarc.info` (`v=DMARC1; p=none; rua=mailto:support@info.shipwell.cc`) and tighten later. Verify.
2. Secrets (server only, Cloud Functions config; never in client code): `RESEND_API_KEY`, `EMAIL_FROM="ShipWell <notifications@info.shipwell.cc>"`, `EMAIL_REPLY_TO="support@info.shipwell.cc"`, `SUPPORT_INBOX=support@info.shipwell.cc`.
3. **Inbound support email:** enable Resend **Inbound** (or the MX route) for `info.shipwell.cc` and point its webhook to a Cloud Function `inboundEmail`. When someone emails `support@info.shipwell.cc`, create (or append to) a support thread in Firestore, matched by sender email and the `[ticket]` id in the subject/`In-Reply-To`, and mark it unread for admin. If the sender has an account, the thread shows in their dashboard too.
4. Admin replies from the website are sent by Resend from `support@info.shipwell.cc` with `Reply-To` the same address, threaded, and also appear in the customer's dashboard inbox.
5. Every email: responsive HTML in the ShipWell look (copy the preview in my Admin → Email log), plain-text version, unsubscribe-safe footer, link buttons to the live site (`https://shipwell.cc/...`). Log every send in Firestore `mail/{id}` (to, subject, kind, shipment, status from the Resend webhook: delivered / bounced). Retry on failure.

### The receiver gets an email on EVERY update about their parcel
Triggered by a Firestore `onWrite` Cloud Function on `shipments/{code}` and its `events` / `alerts`, never from the browser. Send to the receiver's email (and the sender's where noted):

| Event | Receiver | Sender |
|---|---|---|
| Parcel booked (receiver has no account) | "A parcel is on its way to you" + create-account button (invite link) | Booking confirmed |
| Parcel booked (receiver has account) | "A parcel is on its way to you" | Booking confirmed |
| Item approved / issue flagged | – | Yes |
| **Every new checkpoint or status change** | **Yes** (location, note, status, ETA) | Yes |
| ETA changed | **Yes** | Yes |
| Delay / on hold | **Yes** | Yes |
| **Customs charge added (including each further charge)** | **Yes**, "Action required" with amount | – |
| Charge paid / hold released | **Yes** | Yes |
| Out for delivery | **Yes** | Yes |
| Delivered | **Yes** | Yes |
| Admin requests an action (address, ID, reschedule) | **Yes** (to whoever must act) | – |

Respect the notification toggles in Account (on its way / tracking updates / action required), but "action required" emails for charges are always sent. De-duplicate (idempotency key per event id) so one update never sends twice.

## 6. Support: customers can message admin by email and on the website

- **Website:** footer "Contact Us" opens a contact modal (name, email, topic, message; works logged-out). Dashboard gets a **Support** page (sidebar item with unread badge, chat icon with badge in the top bar): conversation list, new-message form (topic, optional parcel), chat thread with bubbles, reply box. Mobile: list then thread, with a back link.
- **Email:** `support@info.shipwell.cc` shown in footer and Support page with a Copy button.
- **Admin → Messages:** inbox of all threads from website and email, unread dots and badge, open/closed status, quick-reply chips, link to the related shipment, reply (emails the customer + shows in their dashboard), close/reopen. **Admin → Email log:** every email sent, with preview.
- New customer message → email to `SUPPORT_INBOX` + admin badge (live listener). Admin reply → email to the customer + customer badge (live listener).
- Rate-limit and spam-protect the public contact form (App Check + reCAPTCHA/Turnstile, honeypot field).

## 7. Interactivity bar (highest level)
Firestore realtime listeners everywhere: new checkpoints, charges, holds, messages and badges appear **without refresh**. Optimistic UI with toasts, skeleton loaders, disabled buttons while saving, error states, keyboard focus rings, `prefers-reduced-motion`, no horizontal scroll at 360px, every button works on first tap on iPhone and Android. Admin only via `/admin` (role custom claim `admin`); no Admin/Dashboard links in the footer; no footer inside the dashboard.

## 8. Acceptance checklist
- [ ] `/ship` and `/quote` have no green block and no sideways scroll at 360–1440px, both themes
- [ ] Stats numbers match the big green style
- [ ] Quote returns prices and carries values to `/ship`
- [ ] Ship Now asks a logged-out user to log in, then continues
- [ ] First visit follows the phone/computer theme (light device opens light, dark device opens dark, no flash); changing the device theme updates the site live until the user picks manually
- [ ] Theme switch is in the menus (website drawer/menu, dashboard Account → Appearance and menu, admin menu), not in the homepage top bar; the choice persists
- [ ] Admin adds charge 1, then charge 2 on the same parcel: parcel re-holds, receiver emailed each time, pays both, hold releases automatically
- [ ] Receiver receives an email for every checkpoint, ETA change, delay, hold, charge, release and delivery
- [ ] Email to support@info.shipwell.cc appears in Admin → Messages; admin reply reaches the sender's inbox
- [ ] SPF/DKIM/DMARC pass for info.shipwell.cc (check with mail-tester)

---

## 9. Dashboard navigation, titles, Quote and Ship inside the dashboard, international defaults (from my screenshots of the live site)

The attached `index.html` shows all of this working. Match it.

**9.1 Top bar title = the tab name, normal case (not all caps)**
- The title at the top of the dashboard shows exactly the tab the user opened: **Home** (not "OVERVIEW"), **Incoming**, **Track**, **Sent**, **Support**, **Account**, **Actions**, **Quote**, **Ship**. Normal sentence case in the body font (Outfit, bold, about 20px), no uppercase, no Bebas.
- Subtitles (date, "Parcels addressed to ...") stay small under it on desktop and are hidden on mobile.

**9.2 Bottom navigation (mobile) and top bar**
- Bottom bar has **5 tabs only**: Home, Incoming, **Track** (raised round emerald button in the centre), Sent, **Support** (red unread badge). **Remove "Actions" from the bottom bar.**
- **Actions live only at the top: the bell** (Action required / notifications) with the red count, opening the Actions page. **Remove the Support chat icon from the top bar.** Top bar right side is: bell, avatar (the theme switch stays out of the top bar, see section 2).
- Desktop sidebar keeps: Home, Incoming, Sent, Track, **Get a Quote**, Action Required (red count), Support (unread count), Account.
- Make sure the bottom bar is truly fixed to the screen on every dashboard page (no parent with `transform`/`animation-fill-mode: both` that pushes it down the page).

**9.3 "Get a quote" on Home**
- Home has two buttons under the greeting: **Get a quote** (outline) and **Ship a parcel** (emerald). On mobile they sit side by side, full width.

**9.4 Quote and Ship stay inside the dashboard**
- New dashboard routes: **`/dashboard/quote`** and **`/dashboard/ship`**. They render inside the dashboard shell (sidebar on desktop, top bar with title "Quote" / "Ship", bottom tab bar on mobile). **No website navbar, no website footer, no jump back to the homepage.**
- Every "Ship a parcel", "Ship something", "Send something" and "Get a quote" button inside the dashboard goes to the dashboard version. "Book at this rate" on the dashboard quote goes to `/dashboard/ship` with the origin, destination, weight, value and service carried over. After booking, "Track Shipment" goes to `/dashboard/track/{CODE}`, and Back / Book another stay in the dashboard.
- A logged-in user who opens `/ship` (typed, bookmarked, or Ship Now on the website) is redirected to `/dashboard/ship`. Logged-out visitors still get the login prompt first (section 3).
- The public `/quote` on the website keeps working for visitors exactly as it does now. The same calculator component is reused in both places, only the shell differs.
- On mobile the sticky price bar ("Step 4 of 4 · $36.76 · Express") sits **above** the bottom tab bar, never behind it or over the content, and the page has bottom padding so nothing is hidden.

**9.5 Wizard polish (from my screenshots of /ship)**
- Step 4 has a big empty gap between the stepper and the "Review & confirm" card: remove it. The step circles and their labels must line up evenly (the "Confirm" circle is currently offset to the right).
- "Confirm Booking" shows a spinner while saving and must end in either the success screen or a visible error. Never stay stuck.

**9.6 International defaults. No Nigerian-only samples anywhere**
- Placeholders and sample text everywhere (sign up, log in, account, ship wizard, contact form, business form, empty states, admin forms, demo or seed data): **John Doe, jane.smith, john.doe@example.com, +1 202 555 0123, 350 Fifth Avenue, New York, 10118, United States** for the sender; receiver sample **Jane Smith, +44 20 7946 0958, 221B Baker Street, London, United Kingdom**. Replace every "+234", Lagos address, Nigerian name or Nigerian-only example.
- Phone fields: show a country-code selector (flag + dial code) defaulting from the visitor's locale or IP, fallback **+1**, and validate with a phone library (libphonenumber). Do not hard-code +234.
- Country dropdowns default to the visitor's country (from locale/IP), fallback United States, not Nigeria. Currency shown as USD unless the visitor's currency is known.

**Acceptance (add to section 8)**
- [ ] Opening Home shows the title "Home" in normal case; each tab shows its own name
- [ ] Bottom bar: Home, Incoming, Track, Sent, Support. No Actions. Bell at the top is the only entry to Actions. No chat icon in the top bar
- [ ] Home has Get a quote and Ship a parcel
- [ ] Quote and Ship open inside the dashboard (no website header/footer), stay there through booking, and return to dashboard tracking
- [ ] `/ship` while logged in lands on `/dashboard/ship`
- [ ] No +234, Lagos, or Nigerian sample names remain in placeholders or demo data
