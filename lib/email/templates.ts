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

export interface EmailParcelSummary {
  id?: string;
  contents: string;
  packageType?: string;
  weightKg: number;
  declaredValue?: number;
}

function renderParcelTableHtml(parcels?: EmailParcelSummary[]): string {
  if (!Array.isArray(parcels) || parcels.length === 0) return "";
  const rows = parcels
    .map(
      (p, idx) => `
      <tr>
        <td style="padding:8px 10px;border-top:1px solid #1E293B;font-size:13px;color:#E2E8F0;" class="sw-copy">
          <strong class="sw-strong" style="color:#F1F5F9;">${parcels.length > 1 ? `#${idx + 1} · ` : ""}${escapeHtml(p.contents || "Parcel")}</strong>
          ${p.packageType ? `<div class="sw-muted" style="font-size:11.5px;color:#94A3B8;">${escapeHtml(p.packageType)}</div>` : ""}
        </td>
        <td align="right" style="padding:8px 10px;border-top:1px solid #1E293B;font-size:13px;color:#E2E8F0;white-space:nowrap;font-family:'JetBrains Mono',Consolas,monospace;" class="sw-copy">
          ${Number(p.weightKg || 0).toFixed(1)} kg
        </td>
        <td align="right" style="padding:8px 10px;border-top:1px solid #1E293B;font-size:13px;color:#E2E8F0;white-space:nowrap;font-family:'JetBrains Mono',Consolas,monospace;" class="sw-copy">
          $${Number(p.declaredValue || 0).toFixed(2)}
        </td>
      </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sw-link-box" style="margin:14px 0 18px 0;background-color:#111827;border:1px solid #1E293B;border-radius:10px;border-collapse:separate;overflow:hidden;">
      <tr>
        <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94A3B8;font-weight:700;">Parcels (${parcels.length})</th>
        <th align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94A3B8;font-weight:700;">Weight</th>
        <th align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94A3B8;font-weight:700;">Value</th>
      </tr>
      ${rows}
    </table>
  `;
}

function renderParcelTableText(parcels?: EmailParcelSummary[]): string {
  if (!Array.isArray(parcels) || parcels.length === 0) return "";
  const lines = parcels.map(
    (p, idx) =>
      `- ${parcels.length > 1 ? `Parcel ${idx + 1}: ` : ""}${p.contents || "Parcel"} (${p.packageType || "Parcel"}, ${Number(p.weightKg || 0).toFixed(1)} kg, $${Number(p.declaredValue || 0).toFixed(2)})`
  );
  return `\nParcels (${parcels.length}):\n${lines.join("\n")}\n`;
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
  parcels?: EmailParcelSummary[];
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

  const parcelNoun =
    params.parcels && params.parcels.length > 1
      ? `${params.parcels.length} parcels`
      : "a parcel";
  const subjectPrefix = params.isReminder ? "Reminder: " : "";
  const subject = sanitizeHeaderText(
    `${subjectPrefix}${senderFirst} is sending you ${parcelNoun} — track it on ShipWell`
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
    ${renderParcelTableHtml(params.parcels)}
    <p style="margin:0 0 16px 0;">
      ShipWell is the live tracking platform for this shipment. Every checkpoint, delay and delivery update &mdash; and the photos ${escapeHtml(senderFirst)} uploaded of the item &mdash; appear on your dashboard.
    </p>
    <p style="margin:0;">Create your free account to see it.</p>
  `;

  const hintHtml = `Use <a href="mailto:${escapeHtml(receiverEmail)}" style="color:#34D399;text-decoration:none;font-weight:600;">${escapeHtml(receiverEmail)}</a> and your parcel finds you. Already made an account? <a href="${escapeHtml(loginUrl)}" style="color:#34D399;text-decoration:underline;font-weight:600;">Sign in</a>.`;

  const footerHtml = `
    You are getting this because ${escapeHtml(params.senderFullName)} entered your email when booking a ShipWell shipment. Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.
    <br><br>
    ShipWell Logistics Ltd. &middot; 14 Broadwick Street, London W1F 8HS
    <br>
    <a href="${escapeHtml(unknownSenderUrl)}" style="color:#94A3B8;text-decoration:underline;">I don&apos;t know this sender</a> &middot; <a href="${escapeHtml(unsubUrl)}" style="color:#94A3B8;text-decoration:underline;">Unsubscribe from reminders</a>
  `;

  const text = `${params.isReminder ? "Reminder: " : ""}A parcel is on its way to you

Hello ${receiverFirst}. ${params.senderFullName} has shipped ${params.contents} to you from ${params.originCity}, ${params.originCountry}.

Your tracking number is ${code} · Estimated delivery ${params.etaLabel}.
${renderParcelTableText(params.parcels)}
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
  parcels?: EmailParcelSummary[];
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

  const parcelNoun =
    params.parcels && params.parcels.length > 1
      ? `${params.parcels.length} parcels`
      : "A parcel";
  const subject = sanitizeHeaderText(
    `${parcelNoun} from ${senderFirst} ${params.parcels && params.parcels.length > 1 ? "are" : "is"} on the way to you`
  );
  const preheader = `Tracking ${code} · Est. delivery ${params.etaLabel}.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">
      Hello ${escapeHtml(receiverFirst)}. <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.senderFullName)}</strong> has shipped <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.contents)}</strong> to you from ${escapeHtml(params.originCity)}, ${escapeHtml(params.originCountry)}.
    </p>
    <p style="margin:0 0 16px 0;">
      Your tracking number is <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;letter-spacing:0.04em;">${escapeHtml(code)}</strong> &middot; Estimated delivery ${escapeHtml(params.etaLabel)}.
    </p>
    ${renderParcelTableHtml(params.parcels)}
    <p style="margin:0;">It&apos;s already on your ShipWell dashboard.</p>
  `;

  const hintHtml = `Not you? <a href="${escapeHtml(switchAccountUrl)}" style="color:#34D399;text-decoration:underline;font-weight:600;">Sign in with a different account</a>.`;

  const footerHtml = `
    You are getting this because ${escapeHtml(params.senderFullName)} entered ${escapeHtml(params.receiverEmail)} when booking a ShipWell shipment. Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.
    <br><br>
    ShipWell Logistics Ltd. &middot; 14 Broadwick Street, London W1F 8HS
    ${params.inviteToken ? `<br><a href="${escapeHtml(unknownSenderUrl)}" style="color:#94A3B8;text-decoration:underline;">I don&apos;t know this sender</a>` : ""}
  `;

  const text = `A parcel is on its way to you

Hello ${receiverFirst}. ${params.senderFullName} has shipped ${params.contents} to you from ${params.originCity}, ${params.originCountry}.
Your tracking number is ${code} · Estimated delivery ${params.etaLabel}.
${renderParcelTableText(params.parcels)}
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
      heading:
        params.parcels && params.parcels.length > 1
          ? `${params.parcels.length} parcels are on their way to you`
          : "A parcel is on its way to you",
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
  parcels?: EmailParcelSummary[];
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
    ${renderParcelTableHtml(params.parcels)}
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
        'Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a> &middot; ShipWell Logistics Ltd.',
    }),
    text: `Your shipment is booked\n\nTracking code: ${code}\nRoute: ${params.routeLabel}\nEstimated delivery: ${params.etaLabel}\nTotal: ${params.totalFormatted}\n${renderParcelTableText(params.parcels)}\nWe've emailed ${params.receiverFullName} at ${params.receiverEmail} so they can follow it too.\n\nView shipment: ${trackUrl}`,
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
  parcels?: EmailParcelSummary[];
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
    ${renderParcelTableHtml(params.parcels)}
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
        'You are receiving updates for an active ShipWell shipment. Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
    }),
    text: `${params.headline}\n\nHello ${first}, update for ${code}:\n${params.details}${renderParcelTableText(params.parcels)}\n\nOpen: ${deepUrl}`,
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
        'Mandatory clearance payment notification for an active ShipWell shipment. Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
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
        'Thank you for using ShipWell. Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
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
      footerHtml:
        'ShipWell Logistics Ltd. &middot; Questions? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
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
      footerHtml: `Ticket ${escapeHtml(params.ticketCode)} · Reply directly to <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>`,
    }),
    text: `Hello ${first},\n\n${params.replyBody}\n\n---\nTicket ${params.ticketCode} · Support: support@mail.shipwell.cc\nView conversation: ${threadUrl}`,
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

export function buildAuthVerificationEmail(params: {
  baseUrl?: string;
  recipientName: string;
  verifyUrl: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const first = sanitizeHeaderText(firstName(params.recipientName || "there"));
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)},</p>
    <p style="margin:0 0 16px 0;">
      Verify your email address to unlock your ShipWell account, live tracking updates, and parcel notifications.
    </p>
    <p style="margin:0;font-size:13.5px;color:#94A3B8;">
      This link expires in 24 hours. If you didn&apos;t create a ShipWell account, you can safely ignore this email.
    </p>
  `;
  return {
    subject: sanitizeHeaderText("Verify your email address for ShipWell"),
    preheader: "Confirm your email address to activate your ShipWell account.",
    html: renderEmailShell({
      baseUrl,
      preheader: "Verify your email for ShipWell",
      heading: "Verify your email address",
      bodyHtml,
      ctaLabel: "Verify email",
      ctaUrl: params.verifyUrl,
      fallbackUrl: params.verifyUrl,
      footerHtml:
        'Sent from an unmonitored security address. Need help? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
    }),
    text: `Hello ${first},\n\nVerify your email address for ShipWell:\n${params.verifyUrl}\n\nNeed help? Contact support@mail.shipwell.cc`,
  };
}

export function buildAuthPasswordResetEmail(params: {
  baseUrl?: string;
  recipientName?: string;
  resetUrl: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const first = sanitizeHeaderText(firstName(params.recipientName || "there"));
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)},</p>
    <p style="margin:0 0 16px 0;">
      We received a request to reset the password on your ShipWell account. Use the button below to choose a new password.
    </p>
    <p style="margin:0;font-size:13.5px;color:#94A3B8;">
      If you didn&apos;t request a password reset, you can ignore this email and your password will stay unchanged.
    </p>
  `;
  return {
    subject: sanitizeHeaderText("Reset your ShipWell password"),
    preheader: "Reset your ShipWell account password securely.",
    html: renderEmailShell({
      baseUrl,
      preheader: "Reset your ShipWell password",
      heading: "Reset your password",
      bodyHtml,
      ctaLabel: "Reset password",
      ctaUrl: params.resetUrl,
      fallbackUrl: params.resetUrl,
      footerHtml:
        'Sent from an unmonitored security address. Need help? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
    }),
    text: `Hello ${first},\n\nReset your ShipWell password here:\n${params.resetUrl}\n\nNeed help? Contact support@mail.shipwell.cc`,
  };
}

export function buildSecurityEmailChangedEmail(params: {
  baseUrl?: string;
  recipientName?: string;
  newEmail: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const first = sanitizeHeaderText(firstName(params.recipientName || "there"));
  const acctUrl = `${baseUrl}/dashboard/account`;
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)},</p>
    <p style="margin:0 0 16px 0;">
      The email address on your ShipWell account was updated to <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.newEmail)}</strong>.
    </p>
    <p style="margin:0;font-size:13.5px;color:#94A3B8;">
      If you did not authorize this change, please contact <a href="mailto:support@mail.shipwell.cc" style="color:#34D399;text-decoration:underline;">support@mail.shipwell.cc</a> immediately.
    </p>
  `;
  return {
    subject: sanitizeHeaderText("Security notice: Your ShipWell email address was changed"),
    preheader: `Account email updated to ${params.newEmail}`,
    html: renderEmailShell({
      baseUrl,
      preheader: "Security alert on your ShipWell account",
      heading: "Account email updated",
      bodyHtml,
      ctaLabel: "Review account security",
      ctaUrl: acctUrl,
      fallbackUrl: acctUrl,
      footerHtml:
        'Sent from an unmonitored security address. Didn&apos;t make this change? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
    }),
    text: `Security notice: Your ShipWell account email was updated to ${params.newEmail}. If this was not you, contact support@mail.shipwell.cc immediately.`,
  };
}

export function buildDraftReminderEmail(params: {
  baseUrl?: string;
  recipientName?: string;
  originCountry?: string;
  destCountry?: string;
  draftUrl: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const first = sanitizeHeaderText(firstName(params.recipientName || "there"));
  const routeText =
    params.originCountry && params.destCountry
      ? `${params.originCountry} → ${params.destCountry}`
      : "your saved shipment";
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(first)},</p>
    <p style="margin:0 0 16px 0;">
      You left a shipment draft (<strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(routeText)}</strong>) unfinished on ShipWell. Your details are saved so you can pick up right where you stopped.
    </p>
  `;
  return {
    subject: sanitizeHeaderText("You left a shipment draft on ShipWell"),
    preheader: `Continue ${routeText} right where you left off.`,
    html: renderEmailShell({
      baseUrl,
      preheader: "Your ShipWell draft is waiting",
      heading: "Continue your shipment draft",
      bodyHtml,
      ctaLabel: "Continue draft",
      ctaUrl: params.draftUrl,
      fallbackUrl: params.draftUrl,
      footerHtml:
        'Manage notification preferences in <a href="' +
        escapeHtml(`${baseUrl}/dashboard/account`) +
        '" style="color:#94A3B8;text-decoration:underline;">Account settings</a>.',
    }),
    text: `Hello ${first},\n\nYou left a shipment draft (${routeText}) on ShipWell. Continue here: ${params.draftUrl}`,
  };
}

export function buildManualPaymentInstructionsEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
  methodName: string;
  amountLabel: string;
  details: Array<{ label: string; value: string }>;
  instructions: string;
  expiresLabel: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const payUrl = `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`;
  const rowsHtml = params.details
    .map(
      (r) =>
        `<tr><td style="padding:6px 0;font-size:13px;color:#94A3B8;">${escapeHtml(r.label)}</td><td style="padding:6px 0;font-size:13.5px;color:#F1F5F9;font-weight:700;text-align:right;font-family:'JetBrains Mono',Consolas,monospace;">${escapeHtml(r.value)}</td></tr>`
    )
    .join("");
  const bodyHtml = `
    <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
    <p style="margin:0 0 14px 0;">
      Complete your <strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(params.methodName)}</strong> payment for parcel <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(code)}</strong> before <strong>${escapeHtml(params.expiresLabel)}</strong>.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111827;border:1px solid #1E293B;border-radius:12px;padding:14px 16px;margin-bottom:14px;">
      <tr><td style="padding:6px 0;font-size:13px;color:#94A3B8;">Amount due</td><td style="padding:6px 0;font-size:14px;color:#34D399;font-weight:700;text-align:right;">${escapeHtml(params.amountLabel)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#94A3B8;">Payment reference</td><td style="padding:6px 0;font-size:13.5px;color:#F1F5F9;font-weight:700;text-align:right;font-family:'JetBrains Mono',Consolas,monospace;">${escapeHtml(params.reference)}</td></tr>
      ${rowsHtml}
    </table>
    <p style="margin:0;font-size:13.5px;color:#CBD5E1;line-height:1.6;">${escapeHtml(params.instructions)}</p>
  `;
  return {
    subject: sanitizeHeaderText(`Payment instructions (${params.reference}) — ${code}`),
    preheader: `Send ${params.amountLabel} using reference ${params.reference}`,
    html: renderEmailShell({
      baseUrl,
      preheader: `Complete payment ${params.reference}`,
      heading: "How to complete your payment",
      bodyHtml,
      ctaLabel: "Upload payment proof",
      ctaUrl: payUrl,
      fallbackUrl: payUrl,
      footerHtml:
        'Questions about payment? Reply to this email or contact <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.',
    }),
    text: `Payment instructions for ${code}\nMethod: ${params.methodName}\nAmount: ${params.amountLabel}\nReference: ${params.reference}\nExpires: ${params.expiresLabel}\n\n${params.instructions}\n\nUpload proof: ${payUrl}`,
  };
}

export function buildPaymentProofSubmittedCustomerEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
  amountLabel: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const trackUrl = `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`;
  return {
    subject: sanitizeHeaderText(`Payment proof received (${params.reference}) — ${code}`),
    preheader: `We are verifying your payment proof for ${code}.`,
    html: renderEmailShell({
      baseUrl,
      preheader: "Payment proof under review",
      heading: "Payment proof received",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
        <p style="margin:0 0 14px 0;">We received your payment proof for <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(params.reference)}</strong> (${escapeHtml(params.amountLabel)}).</p>
        <p style="margin:0;color:#CBD5E1;">Our billing team is reviewing it now and will confirm by email shortly.</p>
      `,
      ctaLabel: "View shipment status",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: 'ShipWell Billing · <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>',
    }),
    text: `Payment proof received for ${code} (${params.reference}, ${params.amountLabel}). View: ${trackUrl}`,
  };
}

export function buildPaymentProofAdminAlertEmail(params: {
  baseUrl?: string;
  trackingCode: string;
  reference: string;
  methodName: string;
  amountLabel: string;
  userEmail: string;
  txId?: string;
  duplicateWarning?: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const queueUrl = `${baseUrl}/payments`;
  return {
    subject: sanitizeHeaderText(`[Review needed] Manual payment ${params.reference} (${params.amountLabel})`),
    preheader: `${params.methodName} proof submitted by ${params.userEmail}`,
    html: renderEmailShell({
      baseUrl,
      preheader: "New manual payment proof queued",
      heading: "Payment proof awaiting review",
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Customer <strong>${escapeHtml(params.userEmail)}</strong> submitted proof for shipment <strong style="font-family:'JetBrains Mono',Consolas,monospace;color:#34D399;">${escapeHtml(params.trackingCode)}</strong>.</p>
        <p style="margin:0 0 8px 0;">Method: <strong>${escapeHtml(params.methodName)}</strong> · Amount: <strong>${escapeHtml(params.amountLabel)}</strong></p>
        <p style="margin:0 0 8px 0;">Reference: <code style="color:#F1F5F9;">${escapeHtml(params.reference)}</code>${params.txId ? ` · TXID: <code style="color:#F1F5F9;">${escapeHtml(params.txId)}</code>` : ""}</p>
        ${params.duplicateWarning ? `<p style="margin:10px 0 0;padding:10px;border-radius:8px;background:rgba(245,158,11,0.14);color:#FBBF24;"><strong>Warning:</strong> ${escapeHtml(params.duplicateWarning)}</p>` : ""}
      `,
      ctaLabel: "Review in Payments Queue",
      ctaUrl: queueUrl,
      fallbackUrl: queueUrl,
      footerHtml: "ShipWell Operations Payments Queue",
    }),
    text: `Payment proof submitted: ${params.reference} (${params.amountLabel}) by ${params.userEmail} for ${params.trackingCode}. Review at ${queueUrl}`,
  };
}

export function buildPaymentApprovedReceiptEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
  methodName: string;
  amountLabel: string;
  kindLabel: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const trackUrl = `${baseUrl}/track/${encodeURIComponent(code)}`;
  return {
    subject: sanitizeHeaderText(`Payment confirmed (${params.reference}) — ${code}`),
    preheader: `Receipt for ${params.amountLabel} via ${params.methodName}`,
    html: renderEmailShell({
      baseUrl,
      preheader: `Payment confirmed for ${code}`,
      heading: "Payment confirmed & receipt issued",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
        <p style="margin:0 0 14px 0;">Your ${escapeHtml(params.kindLabel)} payment of <strong style="color:#34D399;">${escapeHtml(params.amountLabel)}</strong> via <strong>${escapeHtml(params.methodName)}</strong> has been approved.</p>
        <p style="margin:0;color:#CBD5E1;">Reference: <code style="color:#F1F5F9;">${escapeHtml(params.reference)}</code> · Shipment: <code style="color:#34D399;">${escapeHtml(code)}</code></p>
      `,
      ctaLabel: "Track shipment",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: 'ShipWell Payments · <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>',
    }),
    text: `Payment confirmed (${params.reference}): ${params.amountLabel} via ${params.methodName} for ${code}. Track: ${trackUrl}`,
  };
}

export function buildPaymentRejectedEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
  reason: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const trackUrl = `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`;
  return {
    subject: sanitizeHeaderText(`Action needed: Payment proof not verified (${params.reference})`),
    preheader: params.reason,
    html: renderEmailShell({
      baseUrl,
      preheader: "Please upload updated payment proof",
      heading: "Payment proof needs attention",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
        <p style="margin:0 0 14px 0;">We could not verify payment proof for <code style="color:#F1F5F9;">${escapeHtml(params.reference)}</code> on shipment <code style="color:#34D399;">${escapeHtml(code)}</code>.</p>
        <div style="margin:0 0 14px 0;padding:14px;border-radius:10px;background:#111827;border:1px solid #334155;color:#FBBF24;"><strong>Reason:</strong> ${escapeHtml(params.reason)}</div>
        <p style="margin:0;color:#CBD5E1;">You can upload a clearer receipt or updated transaction reference from your dashboard.</p>
      `,
      ctaLabel: "Resubmit payment proof",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: 'Questions? Reply to <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>',
    }),
    text: `Payment proof not verified for ${params.reference} (${code}). Reason: ${params.reason}\nResubmit at ${trackUrl}`,
  };
}

export function buildPaymentMoreInfoEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
  note: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const trackUrl = `${baseUrl}/dashboard/track/${encodeURIComponent(code)}`;
  return {
    subject: sanitizeHeaderText(`More information needed for payment ${params.reference}`),
    preheader: params.note,
    html: renderEmailShell({
      baseUrl,
      preheader: "Additional payment details requested",
      heading: "More details needed",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
        <p style="margin:0 0 14px 0;">Our billing team requested an additional note or screenshot for payment <code style="color:#F1F5F9;">${escapeHtml(params.reference)}</code> (${escapeHtml(code)}):</p>
        <div style="margin:0 0 14px 0;padding:14px;border-radius:10px;background:#111827;border:1px solid #334155;color:#CBD5E1;">${escapeHtml(params.note)}</div>
      `,
      ctaLabel: "Upload updated details",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: 'ShipWell Billing · <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>',
    }),
    text: `More details needed for ${params.reference} (${code}): ${params.note}\nUpdate here: ${trackUrl}`,
  };
}

export function buildPaymentRefundedEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
  amountLabel: string;
  reason?: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const trackUrl = `${baseUrl}/track/${encodeURIComponent(code)}`;
  return {
    subject: sanitizeHeaderText(`Refund processed (${params.reference}) — ${code}`),
    preheader: `${params.amountLabel} refunded`,
    html: renderEmailShell({
      baseUrl,
      preheader: "Payment refunded",
      heading: "Payment refunded",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
        <p style="margin:0 0 14px 0;">A refund of <strong>${escapeHtml(params.amountLabel)}</strong> has been recorded for payment <code style="color:#F1F5F9;">${escapeHtml(params.reference)}</code> on shipment <code style="color:#34D399;">${escapeHtml(code)}</code>.</p>
        ${params.reason ? `<p style="margin:0;color:#94A3B8;">Note: ${escapeHtml(params.reason)}</p>` : ""}
      `,
      ctaLabel: "View shipment",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: 'ShipWell Payments · <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>',
    }),
    text: `Refund of ${params.amountLabel} processed for ${params.reference} (${code}). ${params.reason || ""}`,
  };
}

export function buildPaymentExpiredEmail(params: {
  baseUrl?: string;
  recipientName: string;
  trackingCode: string;
  reference: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const code = sanitizeHeaderText(params.trackingCode).toUpperCase();
  const trackUrl = `${baseUrl}/dashboard/ship`;
  return {
    subject: sanitizeHeaderText(`Payment window expired (${params.reference}) — ${code}`),
    preheader: "The payment window elapsed before completion.",
    html: renderEmailShell({
      baseUrl,
      preheader: "Payment window expired",
      heading: "Payment window expired",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Hello ${escapeHtml(firstName(params.recipientName))},</p>
        <p style="margin:0 0 14px 0;">The payment window for reference <code style="color:#F1F5F9;">${escapeHtml(params.reference)}</code> (${escapeHtml(code)}) expired before payment was completed, so dispatch has not started.</p>
      `,
      ctaLabel: "Start a new booking",
      ctaUrl: trackUrl,
      fallbackUrl: trackUrl,
      footerHtml: 'Need assistance? Email <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>',
    }),
    text: `Payment window expired for ${params.reference} (${code}). You can book again at ${trackUrl}.`,
  };
}

export function buildUnmonitoredReplyNoticeEmail(params: {
  baseUrl?: string;
  attemptedAddress: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  return {
    subject: sanitizeHeaderText("This ShipWell email address is not monitored"),
    preheader: "Please email support@mail.shipwell.cc to reach our team.",
    html: renderEmailShell({
      baseUrl,
      preheader: "Unmonitored inbox notice",
      heading: "Please message support@mail.shipwell.cc",
      bodyHtml: `
        <p style="margin:0 0 14px 0;">We received an email to <code>${escapeHtml(params.attemptedAddress)}</code>, which is an automated sending address and is not monitored.</p>
        <p style="margin:0;">To reach our team, please send your message to <a href="mailto:support@mail.shipwell.cc" style="color:#34D399;font-weight:700;text-decoration:underline;">support@mail.shipwell.cc</a> or open a ticket from your dashboard.</p>
      `,
      ctaLabel: "Open ShipWell Support",
      ctaUrl: `${baseUrl}/dashboard/support`,
      fallbackUrl: `${baseUrl}/dashboard/support`,
      footerHtml: "Automated notice · max 1 notice per 24 hours",
    }),
    text: `Your message to ${params.attemptedAddress} was sent to an unmonitored address. Please contact support@mail.shipwell.cc instead.`,
  };
}



export function buildStaffInviteEmail(params: {
  joinUrl: string;
  inviteeName: string;
  invitedBy: string;
  baseUrl?: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const first = sanitizeHeaderText(firstName(params.inviteeName));
  const bodyHtml = `
    <p style="margin:0 0 14px 0;">Hello ${escapeHtml(first)},</p>
    <p style="margin:0 0 14px 0;"><strong class="sw-strong" style="color:#F1F5F9;">${escapeHtml(sanitizeHeaderText(params.invitedBy))}</strong> invited you to join the ShipWell support team. You will answer customers from <strong class="sw-strong" style="color:#F1F5F9;">support@mail.shipwell.cc</strong> using your own name.</p>
    <p style="margin:0;">Create your account to get started. This invitation expires in 7 days.</p>
  `;
  return {
    subject: sanitizeHeaderText("You are invited to the ShipWell support team"),
    preheader: "Create your ShipWell Mail account.",
    html: renderEmailShell({
      baseUrl,
      preheader: "Create your ShipWell Mail account.",
      heading: "Join the ShipWell team",
      bodyHtml,
      ctaLabel: "Create my account",
      ctaUrl: params.joinUrl,
      fallbackUrl: params.joinUrl,
      footerHtml:
        "If you were not expecting this invitation, ignore this email. ShipWell Logistics Ltd.",
    }),
    text: `You are invited to the ShipWell support team.\n\nCreate your account: ${params.joinUrl}\n\nThis invitation expires in 7 days.`,
  };
}

export function buildBroadcastEmail(params: {
  subject: string;
  message: string;
  ctaLabel?: string;
  ctaUrl?: string;
  baseUrl?: string;
}): EmailPayload {
  const baseUrl = getBaseUrl(params.baseUrl);
  const ctaUrl = params.ctaUrl || `${baseUrl}/dashboard`;
  const paragraphs = params.message
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;white-space:pre-wrap;">${escapeHtml(p.trim())}</p>`
    )
    .join("");
  return {
    subject: sanitizeHeaderText(params.subject),
    preheader: params.message.slice(0, 90),
    html: renderEmailShell({
      baseUrl,
      preheader: params.message.slice(0, 90),
      heading: sanitizeHeaderText(params.subject),
      bodyHtml: paragraphs,
      ctaLabel: params.ctaLabel || "Open ShipWell",
      ctaUrl,
      fallbackUrl: ctaUrl,
      footerHtml: `You are getting this because you have a ShipWell account. Manage your email settings in your <a href="${escapeHtml(baseUrl)}/dashboard" style="color:#94A3B8;text-decoration:underline;">dashboard</a>. Questions? <a href="mailto:support@mail.shipwell.cc" style="color:#94A3B8;text-decoration:underline;">support@mail.shipwell.cc</a>.<br><br>ShipWell Logistics Ltd. &middot; 14 Broadwick Street, London W1F 8HS`,
    }),
    text: `${params.subject}\n\n${params.message}\n\n${ctaUrl}`,
  };
}
