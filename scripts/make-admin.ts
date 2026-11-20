/**
 * Standalone server-only CLI script to promote a Firebase Auth user to ShipWell admin
 * via a Firebase Auth custom claim (`admin: true`).
 * Admin privileges are NEVER granted from client UI or public endpoints.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   npx tsx scripts/make-admin.ts ops@yourdomain.com
 */

import fs from "fs";
import crypto from "crypto";
import path from "path";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = base64Url(signer.sign(sa.private_key));

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Usage: npx tsx scripts/make-admin.ts <user-email>");
    process.exit(1);
  }

  const credPath = path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json"
  );
  if (!fs.existsSync(credPath)) {
    console.error(`Service account JSON not found at: ${credPath}`);
    process.exit(1);
  }

  const sa = JSON.parse(fs.readFileSync(credPath, "utf8")) as ServiceAccount;
  const token = await getAccessToken(sa);
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
    sa.project_id
  )}`;

  const lookupRes = await fetch(`${base}/accounts:lookup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: [email] }),
  });
  const lookupData = (await lookupRes.json()) as {
    users?: { localId: string; email: string; customAttributes?: string }[];
  };
  const target = lookupData.users?.[0];
  if (!target?.localId) {
    throw new Error(`No Firebase Auth user found for ${email}`);
  }

  const existingClaims = target.customAttributes
    ? (JSON.parse(target.customAttributes) as Record<string, unknown>)
    : {};

  const updateRes = await fetch(`${base}/accounts:update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      localId: target.localId,
      customAttributes: JSON.stringify({ ...existingClaims, admin: true }),
    }),
  });
  if (!updateRes.ok) {
    throw new Error(`Failed to set custom claim: ${await updateRes.text()}`);
  }

  console.log(
    `Success: Granted admin:true custom claim to ${target.email} (uid: ${target.localId}).`
  );
  console.log("Ask the user to sign out and sign back in to refresh their ID token.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
