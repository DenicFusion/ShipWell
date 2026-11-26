FEATURE: MULTIPLE PARCELS IN ONE BOOKING. Do NOT redesign anything. Keep my current design and every existing flow working.

GOAL
A sender can add more than one parcel in a single booking. One booking = ONE tracking code, ONE price, ONE payment. Each parcel has its own contents, weight, dimensions, declared value and photos. Max 10 parcels per booking.

STACK (do not change it)
React + Vite on Vercel. Backend = Express in `api/index.ts` -> `createApiApp()` in `lib/server/api-app.ts`. Booking is created server-side in `lib/server/bachs.ts` (the createBooking function around the `contents`, `weightKg`, `photos` parsing). Wizard = `components/ship/ShipWizard.tsx`. Pricing = `lib/quote-engine.ts` (`calculateShippingPricing`). Types = `types/tracking.ts`. Rules = `firestore.rules`.

DATA MODEL (backward compatible, important)
Add `parcels: Parcel[]` to the shipment and booking documents:
```
Parcel = { id: string, contents: string, packageType: string, weightKg: number (billable), actualKg: number,
           lengthCm?: number, widthCm?: number, heightCm?: number, declaredValue: number,
           photos: string[] (1 to 4), review: { state: 'pending'|'approved'|'flagged', note: string, at?: number, by?: string } }
```
Keep the existing top-level fields as AGGREGATES so old shipments, emails, tracking pages and rules keep working:
- `weightKg` = sum of parcel billable weights
- `declaredValue` = sum of parcel declared values
- `contents` = "Bike, 2 boxes" style summary (first 2 parcel names then "+N more"), max 240 chars
- `packageType` = "Multiple parcels" when more than 1, else the single parcel type
- `photos` = first photo of each parcel, max 4 (so the existing rule `photos.size() >= 1 && <= 4` still passes)
- `review.state` = 'approved' only when ALL parcels are approved, 'flagged' if any is flagged, otherwise 'pending'
Old shipments without `parcels` must still render: treat them as one parcel built from the top-level fields (write a helper `getParcels(shipment)` in `types/tracking.ts` and use it everywhere).

1) SHIP WIZARD (components/ship/ShipWizard.tsx)
- In the parcel step, show a list of parcel cards. Each card has: contents, package type, weight, L/W/H, declared value, photos (1 to 4, same uploader as now).
- Button "Add another parcel" (hidden at 10). Each extra card has a Remove button. First parcel cannot be removed.
- Collapsed cards show a one-line summary ("Bike · 15.5 kg · $2,500") with Edit.
- Validate every parcel (contents, weight 0.1 to 50,000, at least 1 photo) and scroll to the first invalid one.
- Review step lists every parcel and a total weight, total declared value and total price.
- Mobile first, no horizontal scroll at 360px.
- Drafts (`lib/drafts.ts`) must save and restore the whole parcels list. Old drafts with a single parcel must still open.

2) PRICING (lib/quote-engine.ts and the server)
- Price each parcel with the existing logic using its own billable weight, then sum. Apply the base/handling fee ONCE per booking, not per parcel. Show a per-parcel line and the total in the wizard.
- The server must recompute the price from `parcels`. Never trust a price sent by the browser.

3) SERVER (lib/server/bachs.ts createBooking)
- Accept `body.parcels` (array). If it is missing, build one parcel from the old single fields so old clients still work.
- Validate each parcel, cap at 10, and cap photos at 4 per parcel and 20 total. Reject with a clear JSON error if invalid.
- Write `parcels` plus the aggregate fields above to the booking, the shipment and the trackingTeaser (teaser `contents` and `weightKg` use the aggregates).
- Booking event note: "Booked N parcels" when N > 1.

4) FIRESTORE RULES (firestore.rules)
- In `isValidShipment`, add 'parcels' to the `hasOnly` list and validate: `parcels is list && parcels.size() >= 1 && parcels.size() <= 10`, and keep the aggregate checks as they are.
- Do the same for any booking/draft rule that lists allowed keys. Update `firebase-blueprint.json`.
- Photos are stored in Storage or as URLs; keep each parcel's photos under the current size limits.
- Tell me to republish the rules in Firebase Console (Vercel does not deploy them).

5) ADMIN (src/pages/admin/AdminShipmentDetailPage.tsx)
- "1. Review items" shows one block per parcel with its photos, contents, weight, value and its own Approve and Flag buttons. Add "Approve all" when more than one.
- Approve/Flag must go through the server, not direct Firestore writes. Approve already uses `POST /api/admin/booking-action` with `action: "approve_item"` (see `adminBookingAction` in `lib/server/bachs.ts`). Extend it to accept `parcelId` (and `approve_all`), update that parcel's review, recompute the shipment-level `review.state`, and write an event "Parcel 2 of 3 approved".
- Do the same for flag: add a server action `flag_item` with `parcelId` and `reason`, so it is not blocked by Firestore rules. Show a red toast with the real error if anything fails.
- Admin list and search show "3 parcels" next to the route.

6) CUSTOMER VIEWS AND EMAILS
- Dashboard Track, public Track page and the shipment detail show a "Parcels (3)" section listing each parcel (contents, weight, value, review status). Keep one tracking code and one timeline.
- Booking confirmation, receiver invite and tracking emails (`lib/email/templates.ts`) list the parcels with a short table. Never print an admin email address in any customer-facing text.
- Item flagged email names which parcel.

RULES
- Tracking codes stay uppercase. One code per booking.
- `npm run build` must pass with no TypeScript errors before every push.
- Old single-parcel shipments, old drafts and old emails must still work.
- Never print keys in logs or send them to the browser.

ACCEPTANCE (prove each on https://shipwell.cc)
- [ ] Add 3 parcels in the wizard, price shows per parcel and in total
- [ ] Pay on delivery books it: ONE uppercase tracking code, 3 parcels saved
- [ ] Dashboard and public track show "Parcels (3)"
- [ ] Admin approves parcel 1 and 2, status stays pending; approves parcel 3, status becomes Approved. No flip back to pending
- [ ] Flagging one parcel flags the shipment and emails the sender naming the parcel
- [ ] A single-parcel booking and an old shipment still work
- [ ] A draft with 2 parcels restores fully from Sent

When done, tell me in 5 lines: what you changed, and what I must do myself (for example republishing firestore.rules).
