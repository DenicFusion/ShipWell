import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getDocFromServer, getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfigLocal from "../firebase-applet-config.json";

const app = !getApps().length ? initializeApp(firebaseConfigLocal) : getApp();
export const db = getFirestore(app, firebaseConfigLocal.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

let connectionChecked = false;

export async function testConnection(): Promise<void> {
  if (connectionChecked || typeof window === "undefined") return;
  connectionChecked = true;
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("the client is offline")
    ) {
      console.error(
        "Please check your Firebase configuration. Firestore client is offline."
      );
    }
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
