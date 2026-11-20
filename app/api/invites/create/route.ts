import { NextRequest, NextResponse } from "next/server";
import { createSignedInviteToken } from "@/lib/invites";
import {
  buildReceiverInviteEmail,
  buildReceiverOnItsWayEmail,
  buildSenderBookingEmail,
} from "@/lib/email/templates";
import {
  checkRateLimit,
  dispatchTransactionalEmail,
} from "@/lib/email/sender";
import { isValidTrackingCode } from "@/types/tracking";

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkRateLimit(`ip:${ip}`, 30, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as {
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
      return NextResponse.json(
        { error: "Valid tracking code and receiver email are required." },
        { status: 400 }
      );
    }

    // Per-sender-to-receiver daily limit (max 5 emails/day)
    if (
      !checkRateLimit(
        `invite:${senderEmail || "op"}->${receiverEmail}`,
        5,
        24 * 60 * 60 * 1000
      )
    ) {
      return NextResponse.json(
        { error: "Daily invite limit reached for this recipient." },
        { status: 429 }
      );
    }

    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;

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
      senderDispatch = await dispatchTransactionalEmail(senderEmail, senderPayload);
    }

    return NextResponse.json({
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
          }
        : null,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to create invite." },
      { status: 500 }
    );
  }
}
