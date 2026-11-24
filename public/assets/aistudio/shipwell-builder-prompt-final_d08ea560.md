URGENT FIX. Do NOT redesign anything. Keep my current design.

I attached `shipwell-fixes.patch`. APPLY IT FIRST (`git apply shipwell-fixes.patch`, or copy the changes by hand if it does not apply). It already fixes the booking hang, the branded verification link, drafts and the Admin SDK credential. Then fix everything below and prove it on the DEPLOYED site (shipwell.cc), not only in the preview.

STACK (do not change it)
React + Vite on Vercel. The backend is an Express app in a Vercel serverless function: `api/index.ts` -> `createApiApp()` in `lib/server/api-app.ts`. It is NOT Next.js and NOT Firebase Cloud Functions. The `functions/` folder is a leftover: ignore it and never build it.

PROBLEM 1: BOOKING FAILS WITH 404 (both payment options)
Error on screen: "The page could not be found. NOT_FOUND ... step=createBooking, code=HTTP_404". It happens for "Card / Instant online (Bachs)" and for "Pay on delivery/pickup". This is a Vercel platform 404, so the `/api/bookings` function is not reachable on the deployment that serves shipwell.cc. Work in this order:
1. Open Vercel > project ship-well > Deployments. Confirm the PRODUCTION deployment is the newest commit on main and that its status is Ready. If not, redeploy.
2. Open that deployment > Functions tab. `api/index` must be listed. If it is missing, the function did not build: fix the build error and make sure `api/index.ts` is inside the project root that Vercel builds (Settings > General > Root Directory must be empty or `./`).
3. Check `vercel.json`: `/api/(.*)` must rewrite to `/api/index` BEFORE the SPA catch-all. The catch-all must exclude `/api`. Keep the www -> apex redirect.
4. Test from the deployed site and report the exact output:
   - `https://shipwell.cc/api/checkout/options` must return JSON, not a 404 page.
   - `POST https://shipwell.cc/api/bookings` must return JSON (a 401 or 400 is fine, a 404 is not).
5. If it now returns 500, open Vercel > Logs and read the real error. The most likely cause is missing Firebase Admin credentials (see Problem 3).
6. The Ship page must never show a Vercel HTML error. If the response is not JSON, show a friendly "Something went wrong, try again" with a Try again button and log the real status to the console. The spinner must end in success or a clear error within 30 seconds.
7. Pay on delivery: booking is created, an uppercase tracking code is issued (SW-20260531-A8F4B2C1 style), success screen shows. Pay now: the server saves the booking as `awaiting_payment`, calls Bachs `POST /v1/checkout-sessions` using the keys saved in Admin > Settings > Payments, and the browser opens the Bachs overlay (`Bachs.Checkout.open({ checkoutUrl })`). If the overlay does not open in 3 seconds, fall back to a visible "Continue to payment" button that opens `checkout_url` in a new tab. Payment is confirmed only by the verified Bachs webhook.

PROBLEM 2: "404: NOT_FOUND - This page doesn't exist" ON shipwell.cc
Refreshing or opening a direct link like /dashboard, /dashboard/support, /admin or /track shows the Vercel 404. Fix:
- `vercel.json` must send every non-API, non-file path to `/index.html` (SPA rewrite). Remove `cleanUrls` if it interferes.
- Make sure shipwell.cc, www.shipwell.cc and admin.shipwell.cc all point to the SAME production deployment (Vercel > Settings > Domains, no domain redirecting to an old deployment).
- Add a branded in-app "Page not found" screen with buttons to Home and Dashboard.
- Test by opening these directly: shipwell.cc/dashboard, shipwell.cc/dashboard/support, shipwell.cc/track, admin.shipwell.cc. None may show the Vercel 404.

PROBLEM 3: ENVIRONMENT (Vercel does not read AI Studio secrets)
Add these in Vercel > Settings > Environment Variables (Production, Preview and Development), then redeploy. Do not ask me to paste any key in this chat. Tell me the exact names and I will paste the values in Vercel myself:
- `FIREBASE_SERVICE_ACCOUNT_JSON`: the whole service-account JSON from Firebase Console > Project settings > Service accounts > Generate new private key (the patch already reads this).
- `SETTINGS_ENCRYPTION_KEY`, `INVITE_TOKEN_SECRET`
- `RESEND_API_KEY`, `RESEND_INBOUND_SECRET`
- `EMAIL_FROM="ShipWell <notifications@mail.shipwell.cc>"`, `EMAIL_REPLY_TO=support@mail.shipwell.cc`, `SUPPORT_INBOX=support@mail.shipwell.cc`
- `APP_URL=https://shipwell.cc` (also `VITE_APP_URL`)
Then publish `firestore.rules` and `storage.rules` to Firebase (`firebase deploy --only firestore:rules,storage`, or paste them in the Firebase Console > Rules). Vercel does not deploy them. Confirm drafts, bookings, payments and paymentMethods are covered.

PROBLEM 4: BRANDED EMAILS (no more Firebase default email)
- Verification and password-reset emails must be sent by our server through Resend from `ShipWell <noreply@mail.shipwell.cc>`, with NO reply-to, in the ShipWell email design. The link must go to `https://shipwell.cc/auth/action?mode=...&oobCode=...` (the patch adds `toBrandedActionUrl`). Make sure the signup flow calls this server endpoint and not Firebase's own `sendEmailVerification`.
- Per-type senders on mail.shipwell.cc: verification and security = noreply@; tracking updates = tracking@; payments and receipts = payments@; booking and general = notifications@; billing = billing@; admin replies = support@ (Reply-To support@mail.shipwell.cc).
- Never use info.shipwell.cc for email. Do not add `mail` as a domain in Vercel.
- Admin > Settings > Email has a "Send test email" button. Show me its result.

PROBLEM 5: DRAFTS
An unfinished shipment must autosave and appear in Sent under "Saved drafts" with a Continue button (the patch and `lib/drafts.ts` are already there). It needs the Firestore rules published (Problem 3). Prove it: start a shipment, leave, open Sent, tap Continue, and the data is back. Show "Draft not saved" if saving fails.

PROBLEM 6: VERCEL CLEANUP
Delete the separate Vercel project named "functions". It always fails (STATIC_BUILD_NO_OUT_DIR) and only adds noise. Only the ship-well project should deploy.

RULES
- `npm run build` must pass with no TypeScript errors before every push.
- Tracking codes are always uppercase. Hero badge stays "Real-time tracking worldwide". No footer inside the dashboard. Mobile first, no horizontal scroll at 360px.
- Never print keys in logs or send them to the browser.

ACCEPTANCE (prove each on https://shipwell.cc)
- [ ] `/api/checkout/options` returns JSON
- [ ] Pay on delivery books, the success screen shows, and the tracking code is uppercase
- [ ] Pay now opens Bachs (overlay or fallback) and the sandbox payment flips the booking to Paid via webhook
- [ ] Any failure shows a clear error with Try again, and the spinner never hangs past 30 seconds
- [ ] Refreshing /dashboard, /dashboard/support and /track never shows the Vercel 404
- [ ] Signup verification email arrives from noreply@mail.shipwell.cc, branded, and the link opens shipwell.cc
- [ ] An unfinished shipment shows in Sent as a draft
- [ ] admin.shipwell.cc opens the admin panel
- [ ] The "functions" Vercel project is deleted

When done, tell me in 5 lines: the root cause you found, what you fixed, and what I must do myself (for example pasting env values in Vercel).
