# ShipWell — Customer Dashboard Upgrade (add to the build prompt; replaces section 7)

Match the attached dashboard screenshots exactly. The dashboard is a **separate app**, not a page of the marketing website.

## Rules
- **No marketing navbar and no footer inside the dashboard.** Logged-in users on `/dashboard/*` see only the dashboard shell below.
- Dark luxury style, same tokens as the site (bg `#07090F`, card `#0D1117`, border `#1E293B`, emerald `#10B981`, Bebas Neue headings, Outfit body, JetBrains Mono for codes).
- Real routes: `/dashboard`, `/dashboard/incoming`, `/dashboard/sent`, `/dashboard/track`, `/dashboard/track/[code]`, `/dashboard/alerts`, `/dashboard/account`. Logged-out visitors get a sign-in screen (with the site navbar), then return to the page they asked for.
- All data is live (Firestore listeners); new checkpoints, alerts and parcels appear without refresh.

## Shell
- **Desktop (≥900px):** fixed left sidebar 268px: ShipWell logo + "Customer portal"; menu: Overview, On Its Way To You (count), Sent By You (count), Track a Parcel, Action Required (red count badge), Account; "Send something" promo card with *Ship a parcel*; user card (avatar initials, name, email); *Website* and *Sign out* buttons. Active item has an emerald tint and a glowing left indicator.
- **Top bar (sticky, glass blur):** page title in Bebas + subtitle (date or context), compact **track search** (auto-uppercases codes), notification bell with red count (links to Action Required), avatar (links to Account).
- **Mobile (<900px):** sidebar hidden; top bar with logo mark + page title + bell + avatar; **bottom tab bar** with 5 tabs: Home, Incoming, **Track (raised round emerald button in the center)**, Sent, Actions (red badge). Respect safe-area insets.

## Pages
1. **Overview:** greeting ("Good morning, {first name}") with a summary sentence and *Ship a parcel* button; a red **attention strip** when any action is open (one-tap *Take action*); 4 stat cards (On its way to you · Sent by you · Action required [red when >0] · Delivered), each linking to its page; **Live shipment hero card** for the most important active parcel (priority: has open action > on hold/delayed > incoming > newest) showing item name, sender/route, status chip, copyable code, a **route map arc** with animated progress and pulsing position marker, a **7-stage stepper** (Booked → Picked up → In transit → At hub → Customs → Out for delivery → Delivered; amber when on hold), latest update line, ETA (with "in N days / tomorrow / today") and *Full tracking*; "On Its Way To You" compact list (first photo, item, sender, status chip); right column: **Track a parcel** box and **Recent activity** feed (latest checkpoints across my parcels, each linking to the tracker). Empty states with clear actions.
2. **On Its Way To You / Sent By You:** filter pills (All · Active · Needs attention · Delivered, with counts); parcel cards: sender's first photo (+ "N photos"), item name, status chip, "From {sender} · City → City" (sent view: "✓ {email} is on ShipWell" or "Waiting for {email} to sign up"), progress bar (amber if held), tracking code, ETA, service, red **action strip** ("Take action →") and *Track live* button.
3. **Track a Parcel (premium tracker, clearly different from the public homepage tracker):** large search card (uppercase input, "Your parcels" quick chips), then:
   - **Action-required banners** at the top when relevant.
   - **Hero card:** "LIVE TRACKING" pulse label, status chip, copy-able code, **huge status headline** (e.g. "Out for delivery", "In customs" — green when delivered, amber for delay, red for hold), latest update + time ago, ETA block, hold/delay banner, **route map arc** with progress, **stepper**, role line ("You are the recipient…" / "You are the sender…" / admin link), *Copy tracking number* and *Back to my parcels*.
   - Two columns: **Shipment history** vertical timeline (current event highlighted with a glowing dot, dashed "Next:" pending stop, distinct icons for scan, delay, action, review; notes in tinted callouts; "N updates" badge) and, on the right, **Shipment details** (service, weight, contents, type, From/To cards) and **Item photos** gallery (tap to zoom, "Uploaded by sender").
   - If the parcel is not linked to the user's account: show only the public summary, and locked cards for history and photos.
   - Invalid or unknown code: friendly empty states ("Check the number" / "No shipment found").
4. **Action Required:** open alerts as cards (type icon, title, message, amount, shipment link, *Take action*), then a "Completed" history. *Take action* opens a modal by type: duty (pay via Stripe/Paystack), address, ID upload, reschedule, custom reply. Resolving releases any linked hold and updates the timeline instantly.
5. **Account:** profile (name, phone editable; email read-only), email-notification toggles (a parcel is on its way to me · tracking updates · action required), Back to website, Sign out.

## Quality bar
Smooth 150–250ms transitions, skeleton loaders (no blank flashes), no horizontal scroll at 360px, keyboard focus states, `prefers-reduced-motion` respected, and every button works on first tap on iPhone and Android.
