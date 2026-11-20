import { NextRequest, NextResponse } from "next/server";
import { verifySignedInviteToken } from "@/lib/invites";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      token?: string;
      code?: string;
    };
    const result = verifySignedInviteToken(
      String(body.token || ""),
      body.code ? String(body.code) : undefined
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { valid: false, expired: false, reason: "Verification failed." },
      { status: 400 }
    );
  }
}
