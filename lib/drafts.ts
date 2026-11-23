import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { deleteStorageUrlSafe } from "@/lib/storage";
import type {
  DraftShipmentRecord,
  DraftWizardData,
} from "@/types/tracking";

const GUEST_DRAFT_KEY = "sw_ship_guest_draft_v1";
export const MAX_USER_DRAFTS = 5;

export function makeDraftId(): string {
  return `dft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function readGuestDraft(): {
  id: string;
  step: number;
  data: DraftWizardData;
  updatedAtMs: number;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(GUEST_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      id?: string;
      step?: number;
      data?: DraftWizardData;
      updatedAtMs?: number;
    };
    if (!parsed?.data) return null;
    return {
      id: parsed.id || makeDraftId(),
      step: Math.min(4, Math.max(1, Number(parsed.step || 1))),
      data: parsed.data,
      updatedAtMs: Number(parsed.updatedAtMs || Date.now()),
    };
  } catch {
    return null;
  }
}

export function writeGuestDraft(payload: {
  id: string;
  step: number;
  data: DraftWizardData;
}): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      GUEST_DRAFT_KEY,
      JSON.stringify({
        id: payload.id,
        step: payload.step,
        data: payload.data,
        updatedAtMs: Date.now(),
      })
    );
  } catch {
    // ignore storage quota errors
  }
}

export function clearGuestDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(GUEST_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export async function listUserDrafts(uid: string): Promise<DraftShipmentRecord[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, "drafts", uid, "items"),
        orderBy("updatedAtMs", "desc")
      )
    );
    return snap.docs.map((d) => ({
      ...(d.data() as DraftShipmentRecord),
      id: d.id,
    }));
  } catch (err) {
    console.warn("Unable to list user drafts:", err);
    return [];
  }
}

export async function saveUserDraft(params: {
  uid: string;
  email?: string | null;
  draftId: string;
  step: number;
  data: DraftWizardData;
  createdAtMs?: number;
}): Promise<void> {
  const { uid, draftId, step, data } = params;
  if (!uid || !draftId) return;
  const now = Date.now();
  const createdAtMs = params.createdAtMs || now;

  // Clean photo metadata to serializable plain objects (never File/Blob)
  const cleanPhotos = (data.photos || []).slice(0, 4).map((p) => ({
    url: String(p.url || ""),
    ...(p.storagePath ? { storagePath: String(p.storagePath) } : {}),
    ...(p.name ? { name: String(p.name) } : {}),
  }));

  const cleanData: DraftWizardData = {
    sName: String(data.sName || ""),
    sEmail: String(data.sEmail || ""),
    sPhone: String(data.sPhone || ""),
    sAddr: String(data.sAddr || ""),
    sCity: String(data.sCity || ""),
    sPost: String(data.sPost || ""),
    sCountry: String(data.sCountry || "United States"),
    rName: String(data.rName || ""),
    rEmail: String(data.rEmail || ""),
    rPhone: String(data.rPhone || ""),
    rAddr: String(data.rAddr || ""),
    rCity: String(data.rCity || ""),
    rPost: String(data.rPost || ""),
    rCountry: String(data.rCountry || "United Kingdom"),
    weight: String(data.weight || "2"),
    pkgType: String(data.pkgType || "Box / Parcel"),
    val: String(data.val || "250"),
    contents: String(data.contents || ""),
    service:
      data.service === "economy" || data.service === "express"
        ? data.service
        : "standard",
    ...(data.paymentMethodId
      ? { paymentMethodId: String(data.paymentMethodId) }
      : {}),
    photos: cleanPhotos.filter((p) => p.url && !p.url.startsWith("blob:")),
  };

  await setDoc(
    doc(db, "drafts", uid, "items", draftId),
    {
      id: draftId,
      uid,
      step: Math.min(4, Math.max(1, Number(step || 1))),
      data: cleanData,
      createdAtMs,
      updatedAtMs: now,
    },
    { merge: true }
  );

  await setDoc(
    doc(db, "draftSummaries", `${uid}_${draftId}`),
    {
      draftId,
      uid,
      email: String(params.email || data.sEmail || "").trim().toLowerCase().slice(0, 160),
      step: Math.min(4, Math.max(1, Number(step || 1))),
      originCountry: cleanData.sCountry.slice(0, 100),
      destCountry: cleanData.rCountry.slice(0, 100),
      createdAtMs,
      updatedAtMs: now,
    },
    { merge: true }
  );

  // Enforce max 5 drafts per user (prune oldest beyond 5)
  try {
    const existing = await listUserDrafts(uid);
    if (existing.length > MAX_USER_DRAFTS) {
      const overflow = existing.slice(MAX_USER_DRAFTS);
      await Promise.all(
        overflow.map((oldDraft) => deleteUserDraft(uid, oldDraft))
      );
    }
  } catch {
    // non-fatal
  }
}

export async function deleteUserDraft(
  uid: string,
  draftOrId: string | DraftShipmentRecord
): Promise<void> {
  if (!uid) return;
  const draftId = typeof draftOrId === "string" ? draftOrId : draftOrId.id;
  if (!draftId) return;

  if (typeof draftOrId !== "string" && Array.isArray(draftOrId.data?.photos)) {
    await Promise.all(
      draftOrId.data.photos.map((p) =>
        p.url ? deleteStorageUrlSafe(p.url) : Promise.resolve()
      )
    );
  }

  await Promise.allSettled([
    deleteDoc(doc(db, "drafts", uid, "items", draftId)),
    deleteDoc(doc(db, "draftSummaries", `${uid}_${draftId}`)),
  ]);
}

export async function migrateGuestDraftToFirestore(
  uid: string,
  email?: string | null
): Promise<string | null> {
  const guest = readGuestDraft();
  if (!guest || !uid) return null;

  const hasContent =
    Boolean(guest.data.rName.trim()) ||
    Boolean(guest.data.rEmail.trim()) ||
    Boolean(guest.data.contents.trim()) ||
    guest.step > 1;
  if (!hasContent) {
    clearGuestDraft();
    return null;
  }

  try {
    await saveUserDraft({
      uid,
      email,
      draftId: guest.id,
      step: guest.step,
      data: guest.data,
      createdAtMs: guest.updatedAtMs,
    });
    clearGuestDraft();
    return guest.id;
  } catch (err) {
    console.warn("Guest draft migration warning:", err);
    return null;
  }
}
