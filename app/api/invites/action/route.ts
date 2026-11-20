import { NextRequest, NextResponse } from "next/server";
import { verifySignedInviteToken } from "@/lib/invites";
import firebaseConfig from "../../../../firebase-applet-config.json";

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

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const action = req.nextUrl.searchParams.get("action") || "";
  const verified = verifySignedInviteToken(token);

  if (!verified.valid && !verified.expired) {
    return new NextResponse(
      `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="max-width:440px;background:#0D1117;border:1px solid #1E293B;border-radius:16px;padding:28px;text-align:center"><h2 style="margin:0 0 12px">Invalid link</h2><p style="color:#94A3B8;font-size:14px">This invitation link is not valid.</p></div></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
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

  return new NextResponse(
    `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="max-width:460px;background:#0D1117;border:1px solid #1E293B;border-radius:18px;padding:32px;text-align:center"><div style="display:inline-block;padding:6px 14px;border-radius:100px;background:rgba(16,185,129,0.12);color:#10B981;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px">ShipWell Trust &amp; Safety</div><h1 style="margin:0 0 12px;font-size:24px">${title}</h1><p style="color:#94A3B8;font-size:14.5px;line-height:1.65;margin:0 0 24px">${bodyText}</p><a href="/" style="display:inline-block;background:#10B981;color:#04120C;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px">Return to ShipWell</a></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
