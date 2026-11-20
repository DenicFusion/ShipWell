import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  dispatchTransactionalEmail,
} from "@/lib/email/sender";
import { escapeHtml, sanitizeHeaderText } from "@/lib/email/templates";
import { ADMIN_EMAIL } from "@/types/tracking";

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkRateLimit(`lead:${ip}`, 10, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many enquiries. Please try again later." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as {
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
      return NextResponse.json(
        { error: "Reference, company, name, and email are required." },
        { status: 400 }
      );
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

    const res = await dispatchTransactionalEmail(ADMIN_EMAIL, {
      subject,
      preheader: `${company} (${plan})`,
      html,
      text,
    });

    return NextResponse.json({
      status: res.status,
      providerId: res.providerId,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to dispatch lead notification." },
      { status: 500 }
    );
  }
}
