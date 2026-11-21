import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { createSignedInviteToken, verifySignedInviteToken } from "./lib/invites.ts";
import {
  buildReceiverInviteEmail,
  buildReceiverOnItsWayEmail,
  buildSenderBookingEmail,
  buildShipmentUpdateEmail,
  escapeHtml,
  sanitizeHeaderText,
} from "./lib/email/templates.ts";
import { checkRateLimit, dispatchTransactionalEmail } from "./lib/email/sender.ts";
import { COUNTRIES, calculateShippingPricing } from "./lib/quote-engine.ts";
import { verifyFirebaseIdTokenFromHeaders } from "./lib/server-auth.ts";
import { ADMIN_EMAIL, isValidTrackingCode, type ServiceTier } from "./types/tracking.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

function getOrigin(req: express.Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() ||
    req.protocol ||
    "http";
  const host = req.headers.host || `localhost:${PORT}`;
  return (
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    `${proto}://${host}`
  );
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw?.split(",")[0]?.trim() || req.ip || "unknown";
}

async function recordInviteActionInFirestore(
  tokenHash: string,
  code: string,
  action: "unknown_sender" | "unsubscribe"
) {
  const docId = `${action}_${tokenHash.slice(0, 24)}_${Date.now()}`;
  const docPath = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/inviteActions/${docId}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:commit`;

  await fetch(commitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docPath,
            fields: {
              tokenHash: { stringValue: tokenHash },
              code: { stringValue: code },
              action: { stringValue: action },
            },
          },
          updateTransforms: [
            {
              fieldPath: "createdAt",
              setToServerValue: "REQUEST_TIME",
            },
          ],
        },
      ],
    }),
  }).catch(() => null);
}

async function startServer() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "2mb" }));

  // ── API ROUTES ──
  app.post("/api/quote", (req, res) => {
    try {
      const body = (req.body || {}) as {
        from?: string;
        to?: string;
        weightKg?: number;
        declaredValue?: number;
        service?: ServiceTier;
      };
      const from = body.from && COUNTRIES.includes(body.from) ? body.from : "Nigeria";
      const to = body.to && COUNTRIES.includes(body.to) ? body.to : "Germany";
      const weightKg = Math.min(50000, Math.max(0.1, Number(body.weightKg) || 1));
      const declaredValue = Math.max(0, Number(body.declaredValue) || 0);
      const service: ServiceTier =
        body.service === "economy" ||
        body.service === "express" ||
        body.service === "standard"
          ? body.service
          : "standard";

      const quote = calculateShippingPricing(
        from,
        to,
        weightKg,
        declaredValue,
        service
      );
      res.json({ quote });
    } catch {
      res.status(400).json({ error: "Invalid quote payload." });
    }
  });

  app.post("/api/invites/verify", (req, res) => {
    try {
      const body = (req.body || {}) as { token?: string; code?: string };
      const result = verifySignedInviteToken(
        String(body.token || ""),
        body.code ? String(body.code) : undefined
      );
      res.json(result);
    } catch {
      res.status(400).json({
        valid: false,
        expired: false,
        reason: "Verification failed.",
      });
    }
  });

  app.get("/api/invites/action", async (req, res) => {
    const token = String(req.query.token || "");
    const action = String(req.query.action || "");
    const verified = verifySignedInviteToken(token);

    if (!verified.valid && !verified.expired) {
      res
        .status(400)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .send(
          `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="max-width:440px;background:#0D1117;border:1px solid #1E293B;border-radius:16px;padding:28px;text-align:center"><h2 style="margin:0 0 12px">Invalid link</h2><p style="color:#94A3B8;font-size:14px">This invitation link is not valid.</p></div></body></html>`
        );
      return;
    }

    const normalizedAction =
      action === "unknown_sender" ? "unknown_sender" : "unsubscribe";
    if (verified.code) {
      await recordInviteActionInFirestore(
        verified.tokenHash,
        verified.code,
        normalizedAction
      );
    }

    const title =
      normalizedAction === "unknown_sender"
        ? "Shipment flagged for review"
        : "Reminders paused";
    const bodyText =
      normalizedAction === "unknown_sender"
        ? "Thank you for letting us know. We have stopped all reminder emails for this parcel and flagged the shipment for ShipWell operations review."
        : "You will no longer receive reminder emails about creating an account for this shipment.";

    res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="max-width:460px;background:#0D1117;border:1px solid #1E293B;border-radius:18px;padding:32px;text-align:center"><div style="display:inline-block;padding:6px 14px;border-radius:100px;background:rgba(16,185,129,0.12);color:#10B981;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px">ShipWell Trust &amp; Safety</div><h1 style="margin:0 0 12px;font-size:24px">${title}</h1><p style="color:#94A3B8;font-size:14.5px;line-height:1.65;margin:0 0 24px">${bodyText}</p><a href="/" style="display:inline-block;background:#10B981;color:#04120C;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px">Return to ShipWell</a></div></body></html>`
      );
  });

  app.post("/api/invites/create", async (req, res) => {
    try {
      const authUser = await verifyFirebaseIdTokenFromHeaders(req.headers);
      if (!authUser) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const ip = getClientIp(req);
      if (!checkRateLimit(`ip:${ip}`, 30, 60 * 60 * 1000)) {
        res
          .status(429)
          .json({ error: "Rate limit exceeded. Please try again later." });
        return;
      }

      const body = (req.body || {}) as {
        code?: string;
        senderFullName?: string;
        senderEmail?: string;
        receiverFullName?: string;
        receiverEmail?: string;
        contents?: string;
        originCity?: string;
        originCountry?: string;
        destinationCity?: string;
        destinationCountry?: string;
        etaLabel?: string;
        totalFormatted?: string;
        receiverHasAccount?: boolean;
        isReminder?: boolean;
        sendSenderReceipt?: boolean;
      };

      const code = String(body.code || "").trim().toUpperCase();
      const receiverEmail = String(body.receiverEmail || "").trim().toLowerCase();
      const senderEmail = String(body.senderEmail || "").trim().toLowerCase();

      if (!isValidTrackingCode(code) || !receiverEmail.includes("@")) {
        res
          .status(400)
          .json({ error: "Valid tracking code and receiver email are required." });
        return;
      }

      if (
        !checkRateLimit(
          `invite:${senderEmail || "op"}->${receiverEmail}`,
          5,
          24 * 60 * 60 * 1000
        )
      ) {
        res
          .status(429)
          .json({ error: "Daily invite limit reached for this recipient." });
        return;
      }

      const baseUrl = getOrigin(req);
      const receiverFullName = String(body.receiverFullName || "Recipient").trim();
      const senderFullName = String(body.senderFullName || "A ShipWell sender").trim();
      const receiverFirst = receiverFullName.split(/\s+/)[0] || "there";

      const { token, tokenHash, expiresAt } = createSignedInviteToken({
        code,
        receiverEmail,
        receiverFirstName: receiverFirst,
        senderFullName,
      });

      const receiverHasAccount = Boolean(body.receiverHasAccount);
      const receiverPayload = receiverHasAccount
        ? buildReceiverOnItsWayEmail({
            baseUrl,
            trackingCode: code,
            senderFullName,
            receiverFullName,
            receiverEmail,
            contents: String(body.contents || "Parcel"),
            originCity: String(body.originCity || "Origin"),
            originCountry: String(body.originCountry || ""),
            etaLabel: String(body.etaLabel || "scheduled"),
            inviteToken: token,
          })
        : buildReceiverInviteEmail({
            baseUrl,
            trackingCode: code,
            senderFullName,
            receiverFullName,
            receiverEmail,
            contents: String(body.contents || "Parcel"),
            originCity: String(body.originCity || "Origin"),
            originCountry: String(body.originCountry || ""),
            etaLabel: String(body.etaLabel || "scheduled"),
            inviteToken: token,
            isReminder: Boolean(body.isReminder),
          });

      const receiverDispatch = await dispatchTransactionalEmail(
        receiverEmail,
        receiverPayload
      );

      let senderDispatch = null;
      let senderSubject = "";
      if (body.sendSenderReceipt && senderEmail.includes("@")) {
        const routeLabel = `${body.originCity || "Origin"} → ${body.destinationCity || "Destination"}`;
        const senderPayload = buildSenderBookingEmail({
          baseUrl,
          trackingCode: code,
          senderFullName,
          receiverFullName,
          receiverEmail,
          routeLabel,
          etaLabel: String(body.etaLabel || "scheduled"),
          totalFormatted: String(body.totalFormatted || "$0.00"),
        });
        senderSubject = senderPayload.subject;
        senderDispatch = await dispatchTransactionalEmail(senderEmail, senderPayload);
      }

      res.json({
        tokenHash,
        expiresAt,
        template: receiverHasAccount
          ? "on_its_way"
          : body.isReminder
            ? "reminder"
            : "invite",
        invitePath: `/track/${code}?invite=${token}`,
        receiverEmailResult: {
          status: receiverDispatch.status,
          providerId: receiverDispatch.providerId,
          subject: receiverPayload.subject,
          html: receiverPayload.html,
          text: receiverPayload.text,
        },
        senderEmailResult: senderDispatch
          ? {
              status: senderDispatch.status,
              providerId: senderDispatch.providerId,
              subject: senderSubject,
            }
          : null,
      });
    } catch {
      res.status(500).json({ error: "Unable to create invite." });
    }
  });

  app.post("/api/shipments/notify", async (req, res) => {
    try {
      const authUser = await verifyFirebaseIdTokenFromHeaders(req.headers);
      if (!authUser) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const body = (req.body || {}) as {
        code?: string;
        toEmail?: string;
        recipientName?: string;
        senderFullName?: string;
        updateType?: "checkpoint" | "delay" | "action_required" | "delivered";
        headline?: string;
        details?: string;
        hasAccount?: boolean;
      };

      const updateType = body.updateType || "checkpoint";
      if ((updateType === "delay" || updateType === "delivered") && !authUser.isAdmin) {
        res.status(403).json({ error: "Operations authorization required." });
        return;
      }

      const code = String(body.code || "").trim().toUpperCase();
      const toEmail = String(body.toEmail || "").trim().toLowerCase();
      if (!isValidTrackingCode(code) || !toEmail.includes("@")) {
        res
          .status(400)
          .json({ error: "Valid tracking code and email required." });
        return;
      }

      const baseUrl = getOrigin(req);
      const recipientName = String(body.recipientName || "Customer").trim();

      let inviteToken: string | undefined;
      if (!body.hasAccount) {
        inviteToken = createSignedInviteToken({
          code,
          receiverEmail: toEmail,
          receiverFirstName: recipientName.split(/\s+/)[0] || "there",
          senderFullName: String(body.senderFullName || "ShipWell sender"),
        }).token;
      }

      const payload = buildShipmentUpdateEmail({
        baseUrl,
        trackingCode: code,
        recipientName,
        updateType,
        headline: String(body.headline || "Shipment status updated"),
        details: String(body.details || ""),
        hasAccount: Boolean(body.hasAccount),
        inviteToken,
      });

      const result = await dispatchTransactionalEmail(toEmail, payload);
      res.json({
        status: result.status,
        providerId: result.providerId,
        subject: payload.subject,
      });
    } catch {
      res
        .status(500)
        .json({ error: "Unable to dispatch shipment notification." });
    }
  });

  app.post("/api/leads/notify", async (req, res) => {
    try {
      const ip = getClientIp(req);
      if (!checkRateLimit(`lead:${ip}`, 10, 60 * 60 * 1000)) {
        res
          .status(429)
          .json({ error: "Too many enquiries. Please try again later." });
        return;
      }

      const body = (req.body || {}) as {
        ref?: string;
        company?: string;
        name?: string;
        email?: string;
        plan?: string;
        volume?: string;
        message?: string;
      };

      const ref = sanitizeHeaderText(body.ref || "").toUpperCase();
      const company = sanitizeHeaderText(body.company || "");
      const name = sanitizeHeaderText(body.name || "");
      const email = sanitizeHeaderText(body.email || "").toLowerCase();
      const plan = sanitizeHeaderText(body.plan || "Growth");
      const volume = sanitizeHeaderText(body.volume || "");
      const message = String(body.message || "").trim();

      if (!ref || !company || !name || !email.includes("@")) {
        res
          .status(400)
          .json({ error: "Reference, company, name, and email are required." });
        return;
      }

      const subject = sanitizeHeaderText(
        `New ShipWell Business Lead (${ref}): ${company} — ${plan}`
      );

      const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;background:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#0D1117;border:1px solid #1E293B;border-radius:16px;padding:28px;">
    <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3B82F6;">ShipWell Business Enquiry</p>
    <h1 style="margin:0 0 18px 0;font-size:22px;color:#F1F5F9;">${escapeHtml(company)}</h1>
    <p style="margin:0 0 8px 0;font-size:14px;color:#E2E8F0;"><strong>Reference:</strong> ${escapeHtml(ref)}</p>
    <p style="margin:0 0 8px 0;font-size:14px;color:#E2E8F0;"><strong>Contact:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
    <p style="margin:0 0 8px 0;font-size:14px;color:#E2E8F0;"><strong>Plan:</strong> ${escapeHtml(plan)}</p>
    <p style="margin:0 0 14px 0;font-size:14px;color:#E2E8F0;"><strong>Monthly volume:</strong> ${escapeHtml(volume)}</p>
    ${message ? `<div style="padding:14px;border-radius:10px;background:#111827;border:1px solid #1E293B;font-size:13.5px;color:#CBD5E1;line-height:1.6;">${escapeHtml(message)}</div>` : ""}
  </div>
</body>
</html>`;

      const text = `New ShipWell Business Enquiry (${ref})
Company: ${company}
Contact: ${name} (${email})
Plan: ${plan}
Monthly volume: ${volume}

${message}`;

      const result = await dispatchTransactionalEmail(ADMIN_EMAIL, {
        subject,
        preheader: `${company} (${plan})`,
        html,
        text,
      });

      res.json({
        status: result.status,
        providerId: result.providerId,
      });
    } catch {
      res
        .status(500)
        .json({ error: "Unable to dispatch lead notification." });
    }
  });

  // ── STATIC / VITE SPA ──
  if (isProduction) {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : true,
      },
      appType: "custom",
    });
    app.use(vite.middlewares);

    app.use(/.*/, async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const indexPath = path.resolve(__dirname, "index.html");
        let template = fs.readFileSync(indexPath, "utf8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ShipWell server listening on http://localhost:${PORT}`);
  });
}

startServer();
