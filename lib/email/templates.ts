export interface EmailPayload {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHeaderText(str: string): string {
  return String(str || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function firstName(fullName: string): string {
  const parts = String(fullName || "").trim().split(/\s+/);
  return parts[0] || "there";
}

function getBaseUrl(origin?: string): string {
  const base =
    origin ||
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://shipwell.cc";
  return base.replace(/\/+$/, "");
}

interface ShellOptions {
  baseUrl: string;
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  fallbackUrl: string;
  hintHtml?: string;
  footerHtml: string;
}

function renderEmailShell(opts: ShellOptions): string {
  const logoUrl = `${opts.baseUrl}/images/shipwell-logo-email.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(opts.heading)}</title>
<style>
  @media (prefers-color-scheme: light) {
    body, .sw-outer { background-color: #F3F6FA !important; color: #0F172A !important; }
    .sw-card { background-color: #FFFFFF !important; border-color: #DCE3EC !important; }
    .sw-heading, .sw-brand, .sw-strong { color: #0F172A !important; }
    .sw-copy { color: #334155 !important; }
    .sw-muted { color: #64748B !important; }
    .sw-link-box { background-color: #F1F5F9 !important; border-color: #DCE3EC !important; }
  }
  @media only screen and (max-width: 600px) {
    .sw-pad { padding: 28px 20px !important; }
    .sw-btn { display: block !important; width: 100% !important; text-align: center !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#07090F;">
    ${escapeHtml(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" class="sw-outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#07090F;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="sw-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#0D1117;border:1px solid #1E293B;border-radius:18px;overflow:hidden;">
          <tr>
            <td class="sw-pad" style="padding:36px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:26px;">
                <tr>
                  <td valign="middle" style="padding-right:11px;">
                    <img src="${escapeHtml(logoUrl)}" alt="ShipWell" width="38" height="38" style="display:block;width:38px;height:38px;border-radius:10px;border:0;">
                  </td>
                  <td valign="middle">
                    <span class="sw-brand" style="font-size:24px;font-weight:800;letter-spacing:0.04em;color:#F1F5F9;line-height:1;display:block;">ShipWell</span>
                    <span style="font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#10B981;display:block;margin-top:3px;">Track &middot; Deliver &middot; Repeat</span>
                  </td>
                </tr>
              </table>

              <h1 class="sw-heading" style="margin:0 0 20px 0;font-size:26px;font-weight:700;line-height:1.25;color:#F1F5F9;letter-spacing:-0.01em;">
                ${escapeHtml(opts.heading)}
              </h1>

              <div class="sw-copy" style="font-size:15.5px;line-height:1.65;color:#E2E8F0;">
                ${opts.bodyHtml}
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 22px 0;">
                <tr>
                  <td align="left">
                    <a href="${escapeHtml(opts.ctaUrl)}" class="sw-btn" style="display:inline-block;background-color:#10B981;color:#04120C;font-size:15.5px;font-weight:700;text-decoration:none;padding:15px 28px;border-radius:12px;line-height:1.2;">
                      ${escapeHtml(opts.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>

              <p class="sw-muted" style="margin:0 0 6px 0;font-size:13px;line-height:1.5;color:#94A3B8;">
                Or copy this link into your browser:
              </p>
              <p style="margin:0 0 22px 0;font-size:12.5px;line-height:1.55;word-break:break-all;font-family:'JetBrains Mono',Consolas,Monaco,monospace;">
                <a href="${escapeHtml(opts.fallbackUrl)}" style="color:#34D399;text-decoration:underline;">${escapeHtml(opts.fallbackUrl)}</a>
              </p>

              ${
                opts.hintHtml
                  ? `<p class="sw-copy" style="margin:0 0 26px 0;font-size:14.5px;line-height:1.6;color:#E2E8F0;">${opts.hintHtml}</p>`
                  : ""
              }

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #1E293B;padding-top:20px;margin-top:8px;">
                <tr>
                  <td class="sw-muted" style="font-size:12.5px;line-height:1.6;color:#64748B;">
                    ${opts.footerHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildReceiverInviteEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  senderFullName: string;
  receiverFullName: string;
  receiverEmail: string;
  contents: string;
  originCity: string;
  originCountry: string;
  etaLabel: string;
  inviteToken: string;
  isReminder?: boolean;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const senderFirst = sanitizeHeaderText(firstName(params.senderFullName));
  const receiverFirst = sanitizeHeaderText(firstName(params.receiverFullName));
  const receiverEmail = sanitizeHeaderText(params.receiverEmail).toLowerCase();
  const inviteUrl = `${baseUrl}/track/${encodeURIComponent(code)}?invite=${encodeURIComponent(params.inviteToken)}`;
  const loginUrl = `${baseUrl}/auth/login?redirect=${encodeURIComponent(`/track/${code}`)}`;
  const unknownSenderUrl = `${baseUrl}/api/invites/action?token=${encodeURIComponent(params.inviteToken)}&action=unknown_sender`;
  const unsubUrl = `${baseUrl}/api/invites/action?token=${encodeURIComponent(params.inviteToken)}&action=unsubscribe`;

  const subjectPrefix = params.isReminder ? "Reminder: " : "";
  const subject = sanitizeHeaderText(
    `${subjectPrefix}${senderFirst} is sending you a parcel — track it on ShipWell`
  );
  const preheader =
    "Create your free account to see live progress and the item photos.";

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">
      Hello ${escapeHtml(receiverFirst)}. <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.senderFullName)}</strong> has shipped <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.contents)}</strong> to you from ${escapeHtml(params.originCity)}, ${escapeHtml(params.originCountry)}.
    </p>
    <p style="margin:0 0 16px 0;">
      Your tracking number is <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;letter-spacing:0.04em;">${escapeHtml(code)}</strong> &middot; Estimated delivery ${escapeHtml(params.etaLabel)}.
    </p>
    <p style="margin:0 0 16px 0;">
      ShipWell is the live tracking platform for this shipment. Every checkpoint, delay and delivery update &mdash; and the photos ${escapeHtml(senderFirst)} uploaded of the item &mdash; appear on your dashboard.
    </p>
    <p style="margin:0;">Create your free account to see it.</p>
  `;

  const hintHtml = `Use <a href="mailto:${escapeHtml(receiverEmail)}" style="color:#34D399;text-decoration:none;font-weight:600;">${escapeHtml(receiverEmail)}</a> and your parcel finds you. Already made an account? <a href="${escapeHtml(loginUrl)}" style="color:#34D399;text-decoration:underline;font-weight:600;">Sign in</a>.`;

  const footerHtml = `
    You are getting this because ${escapeHtml(params.senderFullName)} entered your email when booking a ShipWell shipment. Questions? Reply to this email.
    <br><br>
    ShipWell Logistics Ltd. &middot; 14 Broadwick Street, London W1F 8HS
    <br>
    <a href="${escapeHtml(unknownSenderUrl)}" style="color:#94A3B8;text-decoration:underline;">I don&apos;t know this sender</a> &middot; <a href="${escapeHtml(unsubUrl)}" style="color:#94A3B8;text-decoration:underline;">Unsubscribe from reminders</a>
  `;

  const text = `${params.isReminder ? "Reminder: " : ""}A parcel is on its way to you

Hello ${receiverFirst}. ${params.senderFullName} has shipped ${params.contents} to you from ${params.originCity}, ${params.originCountry}.

Your tracking number is ${code} · Estimated delivery ${params.etaLabel}.

ShipWell is the live tracking platform for this shipment. Every checkpoint, delay and delivery update — and the photos ${senderFirst} uploaded of the item — appear on your dashboard.

Create your free account to see it:
${inviteUrl}

Use ${receiverEmail} and your parcel finds you. Already made an account? Sign in at ${loginUrl}

---
You are getting this because ${params.senderFullName} entered your email when booking a ShipWell shipment. Questions? Reply to this email.
I don't know this sender: ${unknownSenderUrl}
Unsubscribe from reminders: ${unsubUrl}
`;

  return {
    subject,
    preheader,
    html: renderEmailShell({
      baseUrl,
      preheader,
      heading: "A parcel is on its way to you",
      bodyHtml,
      ctaLabel: "Create my account",
      ctaUrl: inviteUrl,
      fallbackUrl: inviteUrl,
      hintHtml,
      footerHtml,
    }),
    text,
  };
}

export function buildReceiverOnItsWayEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  senderFullName: string;
  receiverFullName: string;
  receiverEmail: string;
  contents: string;
  originCity: string;
  originCountry: string;
  etaLabel: string;
  inviteToken?: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const senderFirst = sanitizeHeaderText(firstName(params.senderFullName));
  const receiverFirst = sanitizeHeaderText(firstName(params.receiverFullName));
  const trackUrl = `${baseUrl}/track/${encodeURIComponent(code)}`;
  const switchAccountUrl = `${baseUrl}/auth/login?redirect=${encodeURIComponent(`/track/${code}`)}`;
  const unknownSenderUrl = params.inviteToken
    ? `${baseUrl}/api/invites/action?token=${encodeURIComponent(params.inviteToken)}&action=unknown_sender`
    : `${baseUrl}/track/${encodeURIComponent(code)}`;

  const subject = sanitizeHeaderText(
    `A parcel from ${senderFirst} is on its way to you`
  );
  const preheader = `Tracking ${code} · Est. delivery ${params.etaLabel}.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">
      Hello ${escapeHtml(receiverFirst)}. <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.senderFullName)}</strong> has shipped <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.contents)}</strong> to you from ${escapeHtml(params.originCity)}, ${escapeHtml(params.originCountry)}.
    </p>
    <p style="margin:0 0 16px 0;">
      Your tracking number is <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;letter-spacing:0.04em;">${escapeHtml(code)}</strong> &middot; Estimated delivery ${escapeHtml(params.etaLabel)}.
    </p>
    <p style="margin:0;">It&apos;s already on your ShipWell dashboard.</p>
  `;

  const hintHtml = `Not you? <a href="${escapeHtml(switchAccountUrl)}" style="color:#34D399;text-decoration:underline;font-weight:600;">Sign in with a different account</a>.`;

  const footerHtml = `
    You are getting this because ${escapeHtml(params.senderFullName)} entered ${escapeHtml(params.receiverEmail)} when booking a ShipWell shipment. Questions? Reply to this email.
    <br><br>
    ShipWell Logistics Ltd. &middot; 14 Broadwick Street, London W1F 8HS
    ${params.inviteToken ? `<br><a href="${escapeHtml(unknownSenderUrl)}" style="color:#94A3B8;text-decoration:underline;">I don&apos;t know this sender</a>` : ""}
  `;

  const text = `A parcel is on its way to you

Hello ${receiverFirst}. ${params.senderFullName} has shipped ${params.contents} to you from ${params.originCity}, ${params.originCountry}.
Your tracking number is ${code} · Estimated delivery ${params.etaLabel}.

It's already on your ShipWell dashboard.

Track my parcel: ${trackUrl}

Not you? Sign in with a different account: ${switchAccountUrl}
`;

  return {
    subject,
    preheader,
    html: renderEmailShell({
      baseUrl,
      preheader,
      heading: "A parcel is on its way to you",
      bodyHtml,
      ctaLabel: "Track my parcel",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      hintHtml,
      footerHtml,
    }),
    text,
  };
}

export function buildSenderBookingEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  senderFullName: string;
  receiverFullName: string;
  receiverEmail: string;
  routeLabel: string;
  etaLabel: string;
  totalFormatted: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const senderFirst = sanitizeHeaderText(firstName(params.senderFullName));
  const trackUrl = `${baseUrl}/track/${encodeURIComponent(code)}`;

  const subject = sanitizeHeaderText(
    `Booking confirmed — ${code} is on ShipWell`
  );
  const preheader = `${params.routeLabel} · Est. delivery ${params.etaLabel}.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">
      Hello ${escapeHtml(senderFirst)}. Your shipment booking is confirmed and awaiting initial item review by ShipWell operations.
    </p>
    <p style="margin:0 0 16px 0;">
      Tracking code: <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;letter-spacing:0.04em;">${escapeHtml(code)}</strong><br>
      Route: <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.routeLabel)}</strong><br>
      Estimated delivery: <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.etaLabel)}</strong><br>
      Total: <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.totalFormatted)}</strong>
    </p>
    <p style="margin:0;">
      We&apos;ve emailed <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.receiverFullName)}</strong> at <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.receiverEmail)}</strong> so they can follow it too.
    </p>
  `;

  return {
    subject,
    preheader,
    html: renderEmailShell({
      baseUrl,
      preheader,
      heading: "Your shipment is booked",
      bodyHtml,
      ctaLabel: "View shipment",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml:
        "Questions? Reply to this email. &middot; ShipWell Logistics Ltd.",
    }),
    text: `Your shipment is booked\n\nTracking code: ${code}\nRoute: ${params.routeLabel}\nEstimated delivery: ${params.etaLabel}\nTotal: ${params.totalFormatted}\n\nWe've emailed ${params.receiverFullName} at ${params.receiverEmail} so they can follow it too.\n\nView shipment: ${trackUrl}`,
  };
}

export function buildShipmentUpdateEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  recipientName: string;
  updateType: "checkpoint" | "delay" | "action_required" | "delivered";
  headline: string;
  details: string;
  hasAccount: boolean;
  inviteToken?: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const first = sanitizeHeaderText(firstName(params.recipientName));
  const deepUrl =
    params.updateType === "action_required" && params.hasAccount
      ? `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`
      : params.inviteToken && !params.hasAccount
        ? `${baseUrl}/track/${encodeURIComponent(code)}?invite=${encodeURIComponent(params.inviteToken)}`
        : `${baseUrl}/track/${encodeURIComponent(code)}`;

  const ctaLabel = !params.hasAccount
    ? "Create my account to see updates"
    : params.updateType === "action_required"
      ? "Take action now"
      : "Track shipment";

  const subjectMap = {
    checkpoint: `Shipment update (${code}): ${params.headline}`,
    delay: `Delay / Hold notice (${code}): ${params.headline}`,
    action_required: `Action required on ${code}: ${params.headline}`,
    delivered: `Delivered: ${code}`,
  };

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)}.</p>
    <p style="margin:0 0 16px 0;">
      Update for tracking number <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(code)}</strong>:
    </p>
    <p style="margin:0 0 16px 0;"><strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.headline)}</strong><br>${escapeHtml(params.details)}</p>
    ${
      !params.hasAccount
        ? `<p style="margin:0;">Sign up for free with this email to see full progress, alerts and next steps.</p>`
        : ""
    }
  `;

  return {
    subject: sanitizeHeaderText(subjectMap[params.updateType]),
    preheader: `${code} · ${params.headline}`,
    html: renderEmailShell({
      baseUrl,
      preheader: `${code} · ${params.headline}`,
      heading: params.headline,
      bodyHtml,
      ctaLabel,
      ctaUrl: deepUrl,
      fallbackUrl: deepUrl,
      footerHtml:
        "You are receiving updates for an active ShipWell shipment. Questions? Reply to this email.",
    }),
    text: `${params.headline}\n\nHello ${first}, update for ${code}:\n${params.details}\n\nOpen: ${deepUrl}`,
  };
}

export function buildCustomsChargeEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  recipientName: string;
  chargeType: string;
  amountFormatted: string;
  note: string;
  held: boolean;
  hasAccount: boolean;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const first = sanitizeHeaderText(firstName(params.recipientName));
  const payUrl = `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)}.</p>
    <p style="margin:0 0 16px 0;">
      Customs &amp; clearance on shipment <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(code)}</strong> requires payment before ${params.held ? "movement can resume" : "final release"}:
    </p>
    <p style="margin:0 0 16px 0;">
      Charge: <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.chargeType)}</strong><br>
      Amount due: <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;font-size:18px;">${escapeHtml(params.amountFormatted)}</strong>
      ${params.note ? `<br>Note: ${escapeHtml(params.note)}` : ""}
    </p>
    <p style="margin:0;">
      Pay securely via Bachs Checkout from your ShipWell dashboard. Hold clears automatically once all required charges are settled.
    </p>
  `;

  return {
    subject: sanitizeHeaderText(
      `Action required (${code}): ${params.chargeType} (${params.amountFormatted})`
    ),
    preheader: `${params.chargeType} · ${params.amountFormatted} due on ${code}`,
    html: renderEmailShell({
      baseUrl,
      preheader: `${params.chargeType} · ${params.amountFormatted} due`,
      heading: `${params.chargeType} due (${params.amountFormatted})`,
      bodyHtml,
      ctaLabel: params.hasAccount ? "Pay customs charge" : "Sign in to pay",
      ctaUrl: payUrl,
      fallbackUrl: payUrl,
      footerHtml:
        "Mandatory clearance payment notification for an active ShipWell shipment. Questions? Reply to this email.",
    }),
    text: `Action required on ${code}: ${params.chargeType} (${params.amountFormatted})\n\n${params.note || ""}\nPay at: ${payUrl}`,
  };
}

export function buildChargePaidEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  recipientName: string;
  chargeType: string;
  amountFormatted: string;
  paymentId: string;
  holdReleased: boolean;
  remainingCount: number;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const first = sanitizeHeaderText(firstName(params.recipientName));
  const trackUrl = `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`;

  const statusLine = params.holdReleased
    ? "All holds have been released and your parcel is cleared to move forward."
    : `Your parcel remains on hold with ${params.remainingCount} pending item(s) still open.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)}.</p>
    <p style="margin:0 0 16px 0;">
      Your payment of <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(params.amountFormatted)}</strong> for <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.chargeType)}</strong> on shipment <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(code)}</strong> is confirmed.
    </p>
    <p style="margin:0 0 16px 0;">
      Receipt reference: <strong style="font-family:'JetBrains Mono',Consolas,monospace;">${escapeHtml(params.paymentId)}</strong><br>
      Status: <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(statusLine)}</strong>
    </p>
  `;

  return {
    subject: sanitizeHeaderText(
      `Payment confirmed (${code}) — ${params.amountFormatted}`
    ),
    preheader: `${params.chargeType} paid (${params.amountFormatted})`,
    html: renderEmailShell({
      baseUrl,
      preheader: `Payment confirmed for ${code}`,
      heading: params.holdReleased ? "Payment confirmed & hold released" : "Payment confirmed",
      bodyHtml,
      ctaLabel: "View shipment & receipt",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml:
        "Thank you for using ShipWell. Questions? Reply to this email.",
    }),
    text: `Payment confirmed for ${code}: ${params.chargeType} (${params.amountFormatted})\nRef: ${params.paymentId}\n${statusLine}\nView: ${trackUrl}`,
  };
}

export function buildHoldReleasedEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  recipientName: string;
  etaLabel: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const first = sanitizeHeaderText(firstName(params.recipientName));
  const trackUrl = `${baseUrl}/track/${encodeURIComponent(code)}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)}.</p>
    <p style="margin:0 0 16px 0;">
      Good news — the hold on shipment <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(code)}</strong> has been released.
    </p>
    <p style="margin:0;">Estimated delivery remains <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.etaLabel)}</strong>.</p>
  `;

  return {
    subject: sanitizeHeaderText(`Hold released — ${code} is moving again`),
    preheader: `${code} hold cleared · Est. delivery ${params.etaLabel}`,
    html: renderEmailShell({
      baseUrl,
      preheader: `${code} hold released`,
      heading: "Hold released — moving again",
      bodyHtml,
      ctaLabel: "Track live",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: "ShipWell Logistics Ltd. · Questions? Reply to this email.",
    }),
    text: `Hold released for ${code}. Estimated delivery: ${params.etaLabel}\nTrack: ${trackUrl}`,
  };
}

export function buildSupportReplyEmail(params: {
  baseUrl?: string;
  ticketCode: string;
  recipientName: string;
  subject: string;
  replyBody: string;
  trackingCode?: string | null;
  threadId: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const first = sanitizeHeaderText(firstName(params.recipientName));
  const threadUrl = `${baseUrl}/dashboard/support/${encodeURIComponent(params.threadId)}`;
  const codeNote = params.trackingCode ? ` · Parcel ${params.trackingCode}` : "";

  const bodyHtml = `
    <p style="margin:0 0 14px 0;">Hello ${escapeHtml(first)},</p>
    <div style="margin:0 0 16px 0;padding:16px 18px;border-radius:12px;background:#111827;border:1px solid #1E293B;white-space:pre-wrap;color:#F1F5F9;font-size:14.5px;line-height:1.6;">${escapeHtml(params.replyBody)}</div>
    <p style="margin:0;font-size:13.5px;color:#94A3B8;">Reply directly to this email or continue the conversation in your ShipWell Support inbox.</p>
  `;

  return {
    subject: sanitizeHeaderText(
      `Re: ${params.subject} [${params.ticketCode}]${codeNote}`
    ),
    preheader: params.replyBody.slice(0, 90),
    html: renderEmailShell({
      baseUrl,
      preheader: `Reply on ${params.ticketCode}`,
      heading: `Support reply (${params.ticketCode})`,
      bodyHtml,
      ctaLabel: "View in dashboard",
      ctaUrl: threadUrl,
      fallbackUrl: threadUrl,
      footerHtml: `Ticket ${escapeHtml(params.ticketCode)} · Reply directly to support@info.shipwell.cc`,
    }),
    text: `Hello ${first},\n\n${params.replyBody}\n\n---\nTicket ${params.ticketCode}\nView conversation: ${threadUrl}`,
  };
}

export function buildSupportInboundAdminEmail(params: {
  baseUrl?: string;
  ticketCode: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  trackingCode?: string | null;
  threadId: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const adminUrl = `${baseUrl}/admin/thread/${encodeURIComponent(params.threadId)}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      From: <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.senderName)}</strong> (${escapeHtml(params.senderEmail)})<br>
      Ticket: <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(params.ticketCode)}</strong>
      ${params.trackingCode ? `<br>Shipment: <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(params.trackingCode)}</strong>` : ""}
    </p>
    <div style="margin:0 0 12px 0;padding:16px 18px;border-radius:12px;background:#111827;border:1px solid #1E293B;white-space:pre-wrap;color:#F1F5F9;font-size:14.5px;line-height:1.6;">${escapeHtml(params.body)}</div>
  `;

  return {
    subject: sanitizeHeaderText(
      `[Support ${params.ticketCode}] ${params.subject}`
    ),
    preheader: `${params.senderName}: ${params.body.slice(0, 80)}`,
    html: renderEmailShell({
      baseUrl,
      preheader: `New message from ${params.senderEmail}`,
      heading: `New support message (${params.ticketCode})`,
      bodyHtml,
      ctaLabel: "Open in Admin Inbox",
      ctaUrl: adminUrl,
      fallbackUrl: adminUrl,
      footerHtml: "ShipWell Operations Inbox",
    }),
    text: `New support message ${params.ticketCode}\nFrom: ${params.senderName} (${params.senderEmail})\n${params.trackingCode ? `Shipment: ${params.trackingCode}\n` : ""}\n${params.body}\n\nOpen: ${adminUrl}`,
  };
}
