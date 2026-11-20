import { NextRequest, NextResponse } from "next/server";
import { createSignedInviteToken } from "@/lib/invites";
import { buildShipmentUpdateEmail } from "@/lib/email/templates";
import { dispatchTransactionalEmail } from "@/lib/email/sender";
import { isValidTrackingCode } from "@/types/tracking";
import { verifyFirebaseIdTokenFromRequest } from "@/lib/server-auth";

export async function POST(req: NextRequest) {
  try {
    const authUser = await verifyFirebaseIdTokenFromRequest(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
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
      return NextResponse.json(
        { error: "Operations authorization required." },
        { status: 403 }
      );
    }

    const code = String(body.code || "").trim().toUpperCase();
    const toEmail = String(body.toEmail || "").trim().toLowerCase();
    if (!isValidTrackingCode(code) || !toEmail.includes("@")) {
      return NextResponse.json(
        { error: "Valid tracking code and email required." },
        { status: 400 }
      );
    }

    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
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
      updateType: body.updateType || "checkpoint",
      headline: String(body.headline || "Shipment status updated"),
      details: String(body.details || ""),
      hasAccount: Boolean(body.hasAccount),
      inviteToken,
    });

    const result = await dispatchTransactionalEmail(toEmail, payload);
    return NextResponse.json({
      status: result.status,
      providerId: result.providerId,
      subject: payload.subject,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to dispatch shipment notification." },
      { status: 500 }
    );
  }
}
