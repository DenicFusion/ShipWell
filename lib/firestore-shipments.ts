import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, sha256Hex } from "@/lib/firebase";
import { handleFirestoreError, OperationType } from "@/lib/firebase-errors";
import {
  addBusinessDays,
  calculateShippingPricing,
  formatMoney,
  formatShortDay,
  PLACES,
} from "@/lib/quote-engine";
import {
  firestoreTimeToMs,
  generateTrackingCode,
  normalizeEmail,
  STAGES,
  type AlertKind,
  type AlertTarget,
  type BusinessLead,
  type PartyInfo,
  type ServiceTier,
  type ShipmentAlert,
  type ShipmentInviteRecord,
  type ShipmentRecord,
  type ShipmentStage,
  type TrackingEvent,
  type TrackingTeaser,
  type UserProfile,
} from "@/types/tracking";

export async function checkAccountExists(email: string): Promise<boolean> {
  const clean = normalizeEmail(email);
  if (!clean) return false;
  try {
    const h = await sha256Hex(clean);
    const snap = await getDoc(doc(db, "accountStatus", h));
    return snap.exists() && Boolean(snap.data()?.exists);
  } catch {
    return false;
  }
}

export async function markAccountExists(email: string): Promise<void> {
  const clean = normalizeEmail(email);
  if (!clean) return;
  try {
    const h = await sha256Hex(clean);
    await setDoc(doc(db, "accountStatus", h), {
      exists: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, "accountStatus");
  }
}

export async function syncUserProfileDoc(params: {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
}): Promise<void> {
  const cleanEmail = normalizeEmail(params.email);
  const userRef = doc(db, "users", params.uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: params.uid,
        name: params.name.trim() || "ShipWell Customer",
        email: cleanEmail,
        phone: params.phone?.trim() || "",
        company: params.company?.trim() || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name: params.name.trim() || snap.data().name || "ShipWell Customer",
        phone: params.phone?.trim() ?? snap.data().phone ?? "",
        company: params.company?.trim() ?? snap.data().company ?? "",
        updatedAt: serverTimestamp(),
      });
    }
    await markAccountExists(cleanEmail);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${params.uid}`);
  }
}

export interface CreateShipmentInput {
  senderId: string;
  sender: PartyInfo;
  receiver: PartyInfo;
  service: ServiceTier;
  weightKg: number;
  packageType: string;
  contents: string;
  declaredValue: number;
  paymentMethod: string;
  photos: string[];
}

export async function createShipmentBooking(
  input: CreateShipmentInput
): Promise<{
  shipment: ShipmentRecord;
  receiverHasAccount: boolean;
  invitePreview?: { subject: string; html: string; invitePath: string };
}> {
  let code = generateTrackingCode();
  for (let i = 0; i < 4; i++) {
    const existingTeaser = await getDoc(doc(db, "trackingTeasers", code));
    if (!existingTeaser.exists()) break;
    code = generateTrackingCode();
  }

  const quote = calculateShippingPricing(
    input.sender.country,
    input.receiver.country,
    input.weightKg,
    input.declaredValue,
    input.service
  );
  const etaMs = addBusinessDays(new Date(), quote.days[1] + 1).getTime();
  const senderEmail = normalizeEmail(input.sender.email);
  const receiverEmail = normalizeEmail(input.receiver.email);
  const originCity =
    input.sender.city.trim() || PLACES[input.sender.country]?.city || "Origin";
  const destCity =
    input.receiver.city.trim() ||
    PLACES[input.receiver.country]?.city ||
    "Destination";

  const senderClean: PartyInfo = {
    name: input.sender.name.trim(),
    email: senderEmail,
    phone: input.sender.phone.trim(),
    address: input.sender.address.trim(),
    city: originCity,
    postal: input.sender.postal?.trim() || "",
    country: input.sender.country,
  };
  const receiverClean: PartyInfo = {
    name: input.receiver.name.trim(),
    email: receiverEmail,
    phone: input.receiver.phone.trim(),
    address: input.receiver.address.trim(),
    city: destCity,
    postal: input.receiver.postal?.trim() || "",
    country: input.receiver.country,
  };

  const batch = writeBatch(db);
  const shipRef = doc(db, "shipments", code);
  const teaserRef = doc(db, "trackingTeasers", code);
  const eventId = `ev_${Date.now().toString(36)}`;
  const eventRef = doc(db, "shipments", code, "events", eventId);

  const shipmentPayload = {
    code,
    senderId: input.senderId,
    senderEmail,
    receiverEmail,
    sender: senderClean,
    receiver: receiverClean,
    service: input.service,
    weightKg: Number(input.weightKg.toFixed(2)),
    packageType: input.packageType,
    contents: input.contents.trim(),
    declaredValue: Number(input.declaredValue || 0),
    priceTotal: quote.total,
    paymentMethod: input.paymentMethod,
    status: "Booked" as ShipmentStage,
    eta: etaMs,
    photos: input.photos.slice(0, 4),
    hold: null,
    nextStop: null,
    review: {
      state: "pending" as const,
      note: "",
      at: null,
      by: null,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const teaserPayload = {
    code,
    senderId: input.senderId,
    status: "Booked" as ShipmentStage,
    holdType: null,
    originCity,
    originCountry: input.sender.country,
    destinationCity: destCity,
    destinationCountry: input.receiver.country,
    service: input.service,
    weightKg: Number(input.weightKg.toFixed(2)),
    contents: input.contents.trim(),
    eta: etaMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const initialEvent = {
    stage: "Booked" as ShipmentStage,
    label: "Booking received",
    loc: `${originCity}, ${input.sender.country}`,
    note: "Awaiting item review by ShipWell operations",
    kind: "scan" as const,
    ts: Date.now(),
    createdBy: input.senderId,
    createdAt: serverTimestamp(),
  };

  try {
    batch.set(shipRef, shipmentPayload);
    batch.set(teaserRef, teaserPayload);
    batch.set(eventRef, initialEvent);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `shipments/${code}`);
  }

  const receiverHasAccount = await checkAccountExists(receiverEmail);
  let invitePreview:
    | { subject: string; html: string; invitePath: string }
    | undefined;

  try {
    const res = await fetch("/api/invites/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        senderFullName: senderClean.name,
        senderEmail,
        receiverFullName: receiverClean.name,
        receiverEmail,
        contents: shipmentPayload.contents,
        originCity,
        originCountry: input.sender.country,
        destinationCity: destCity,
        destinationCountry: input.receiver.country,
        etaLabel: `by ${formatShortDay(etaMs)}`,
        totalFormatted: formatMoney(quote.total),
        receiverHasAccount,
        sendSenderReceipt: true,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const invId = `inv_${Date.now().toString(36)}`;
      await setDoc(doc(db, "shipments", code, "invites", invId), {
        tokenHash: data.tokenHash,
        receiverEmail,
        template: data.template,
        status: data.receiverEmailResult.status,
        emailCount: 1,
        sentAt: Date.now(),
        createdBy: input.senderId,
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, "emailLogs", `em_${Date.now().toString(36)}`), {
        to: receiverEmail,
        code,
        template: data.template,
        subject: data.receiverEmailResult.subject,
        status: data.receiverEmailResult.status,
        providerId: data.receiverEmailResult.providerId || "",
        createdBy: input.senderId,
        createdAt: serverTimestamp(),
      });

      invitePreview = {
        subject: data.receiverEmailResult.subject,
        html: data.receiverEmailResult.html,
        invitePath: data.invitePath,
      };
    }
  } catch (err) {
    console.warn("Invite dispatch warning:", err);
  }

  return {
    shipment: {
      ...shipmentPayload,
      createdAtMs: Date.now(),
      events: [{ ...initialEvent, id: eventId }],
      alerts: [],
    },
    receiverHasAccount,
    invitePreview,
  };
}

export async function fetchTrackingTeaser(
  code: string
): Promise<TrackingTeaser | null> {
  try {
    const snap = await getDoc(doc(db, "trackingTeasers", code));
    if (!snap.exists()) return null;
    return snap.data() as TrackingTeaser;
  } catch {
    return null;
  }
}

export async function fetchFullShipmentBundle(
  code: string
): Promise<ShipmentRecord | null> {
  try {
    const snap = await getDoc(doc(db, "shipments", code));
    if (!snap.exists()) return null;
    const data = snap.data() as ShipmentRecord;
    const [evSnap, alSnap, invSnap] = await Promise.all([
      getDocs(
        query(collection(db, "shipments", code, "events"), orderBy("ts", "asc"))
      ),
      getDocs(collection(db, "shipments", code, "alerts")),
      getDocs(collection(db, "shipments", code, "invites")),
    ]);

    const events: TrackingEvent[] = evSnap.docs.map((d) => ({
      ...(d.data() as Omit<TrackingEvent, "id">),
      id: d.id,
    }));
    const alerts: ShipmentAlert[] = alSnap.docs.map((d) => {
      const a = d.data() as Omit<ShipmentAlert, "id">;
      return {
        ...a,
        id: d.id,
        createdAtMs: firestoreTimeToMs(a.createdAt),
        resolvedAtMs: a.resolvedAt ? firestoreTimeToMs(a.resolvedAt) : undefined,
      };
    });
    const invites: ShipmentInviteRecord[] = invSnap.docs.map((d) => ({
      ...(d.data() as Omit<ShipmentInviteRecord, "id">),
      id: d.id,
    }));

    return {
      ...data,
      createdAtMs: firestoreTimeToMs(data.createdAt),
      events,
      alerts,
      invites,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("permission-denied") || msg.includes("Missing or insufficient permissions")) {
      return null;
    }
    handleFirestoreError(err, OperationType.GET, `shipments/${code}`);
    return null;
  }
}

export async function fetchCustomerShipments(params: {
  uid: string;
  email: string;
  emailVerified: boolean;
}): Promise<{ incoming: ShipmentRecord[]; sent: ShipmentRecord[] }> {
  const cleanEmail = normalizeEmail(params.email);
  const attachMeta = async (s: ShipmentRecord): Promise<ShipmentRecord> => {
    const [evSnap, alSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "shipments", s.code, "events"),
          orderBy("ts", "asc")
        )
      ),
      getDocs(collection(db, "shipments", s.code, "alerts")),
    ]);
    return {
      ...s,
      createdAtMs: firestoreTimeToMs(s.createdAt),
      events: evSnap.docs.map((d) => ({
        ...(d.data() as Omit<TrackingEvent, "id">),
        id: d.id,
      })),
      alerts: alSnap.docs.map((d) => ({
        ...(d.data() as Omit<ShipmentAlert, "id">),
        id: d.id,
        createdAtMs: firestoreTimeToMs(d.data().createdAt),
        resolvedAtMs: d.data().resolvedAt
          ? firestoreTimeToMs(d.data().resolvedAt)
          : undefined,
      })),
    };
  };

  try {
    const sentSnap = await getDocs(
      query(collection(db, "shipments"), where("senderId", "==", params.uid))
    );
    const sent = await Promise.all(
      sentSnap.docs.map((d) => attachMeta(d.data() as ShipmentRecord))
    );

    let incoming: ShipmentRecord[] = [];
    if (params.emailVerified && cleanEmail) {
      const incSnap = await getDocs(
        query(
          collection(db, "shipments"),
          where("receiverEmail", "==", cleanEmail)
        )
      );
      incoming = await Promise.all(
        incSnap.docs.map((d) => attachMeta(d.data() as ShipmentRecord))
      );
    }

    sent.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    incoming.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return { incoming, sent };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "shipments");
    return { incoming: [], sent: [] };
  }
}

export async function resolveShipmentAlert(params: {
  shipment: ShipmentRecord;
  alert: ShipmentAlert;
  actorUid: string;
  response: string;
  updatedAddress?: string;
  attachmentName?: string;
}): Promise<void> {
  const { shipment, alert, actorUid, response, updatedAddress, attachmentName } =
    params;
  const code = shipment.code;

  try {
    const batch = writeBatch(db);
    const alertRef = doc(db, "shipments", code, "alerts", alert.id);
    batch.update(alertRef, {
      status: "resolved",
      resolvedAt: serverTimestamp(),
      response: response.trim(),
      ...(attachmentName ? { attachmentName } : {}),
    });

    const evId = `ev_${Date.now().toString(36)}_res`;
    batch.set(doc(db, "shipments", code, "events", evId), {
      stage: shipment.status,
      label: `Action completed by ${alert.to}`,
      loc: "",
      note: `${alert.title} — ${response.trim()}`,
      kind: "action",
      ts: Date.now(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });

    const shipUpdates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    const isLinkedHold = shipment.hold && shipment.hold.alertId === alert.id;
    if (isLinkedHold) {
      shipUpdates.hold = null;
      const relId = `ev_${(Date.now() + 1).toString(36)}_rel`;
      batch.set(doc(db, "shipments", code, "events", relId), {
        stage: shipment.status,
        label: "Hold released",
        loc: "",
        note: "Shipment is moving again",
        kind: "info",
        ts: Date.now() + 1,
        createdBy: actorUid,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, "trackingTeasers", code), {
        holdType: null,
        updatedAt: serverTimestamp(),
      });
    }
    if (updatedAddress && alert.to === "receiver") {
      shipUpdates.receiver = {
        ...shipment.receiver,
        address: updatedAddress.trim(),
      };
    }

    if (Object.keys(shipUpdates).length > 1) {
      batch.update(doc(db, "shipments", code), shipUpdates);
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `shipments/${code}/alerts/${alert.id}`
    );
  }
}

export async function submitBusinessLead(input: {
  company: string;
  name: string;
  email: string;
  plan: "Starter" | "Growth" | "Enterprise";
  volume: string;
  message: string;
}): Promise<string> {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const ref =
    "BZ-" +
    Array.from(bytes)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  const leadId = `lead_${Date.now().toString(36)}_${ref.slice(3)}`;

  try {
    await setDoc(doc(db, "leads", leadId), {
      ref,
      company: input.company.trim(),
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      plan: input.plan,
      volume: input.volume,
      message: input.message.trim(),
      status: "new",
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `leads/${leadId}`);
  }
  return ref;
}

// ── ADMIN OPERATIONS ────────────────────────────────────────────────────────

export async function fetchAllShipmentsForAdmin(): Promise<ShipmentRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, "shipments"), limit(200))
    );
    const items = await Promise.all(
      snap.docs.map(async (d) => {
        const s = d.data() as ShipmentRecord;
        const [evSnap, alSnap, invSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "shipments", s.code, "events"),
              orderBy("ts", "asc")
            )
          ),
          getDocs(collection(db, "shipments", s.code, "alerts")),
          getDocs(collection(db, "shipments", s.code, "invites")),
        ]);
        return {
          ...s,
          createdAtMs: firestoreTimeToMs(s.createdAt),
          events: evSnap.docs.map((e) => ({
            ...(e.data() as Omit<TrackingEvent, "id">),
            id: e.id,
          })),
          alerts: alSnap.docs.map((a) => ({
            ...(a.data() as Omit<ShipmentAlert, "id">),
            id: a.id,
            createdAtMs: firestoreTimeToMs(a.data().createdAt),
            resolvedAtMs: a.data().resolvedAt
              ? firestoreTimeToMs(a.data().resolvedAt)
              : undefined,
          })),
          invites: invSnap.docs.map((i) => ({
            ...(i.data() as Omit<ShipmentInviteRecord, "id">),
            id: i.id,
          })),
        };
      })
    );
    items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return items;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "shipments");
    return [];
  }
}

export async function fetchAllUsersForAdmin(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(query(collection(db, "users"), limit(200)));
    return snap.docs.map((d) => ({
      ...(d.data() as UserProfile),
      createdAtMs: firestoreTimeToMs(d.data().createdAt),
    }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "users");
    return [];
  }
}

export async function fetchAllLeadsForAdmin(): Promise<BusinessLead[]> {
  try {
    const snap = await getDocs(query(collection(db, "leads"), limit(100)));
    return snap.docs.map((d) => ({ ...(d.data() as BusinessLead), id: d.id }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "leads");
    return [];
  }
}

async function logAdminAudit(params: {
  actorUid: string;
  actorEmail: string;
  action: string;
  code?: string;
  detail: string;
}) {
  const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await setDoc(doc(db, "auditLogs", id), {
    actorUid: params.actorUid,
    actorEmail: params.actorEmail,
    action: params.action,
    ...(params.code ? { code: params.code } : {}),
    detail: params.detail.slice(0, 400),
    createdAt: serverTimestamp(),
  });
}

export async function adminApproveShipmentItem(params: {
  shipment: ShipmentRecord;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const { shipment, actorUid, actorEmail } = params;
  const code = shipment.code;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "shipments", code), {
      review: {
        state: "approved",
        note: "",
        at: Date.now(),
        by: actorEmail,
      },
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "shipments", code, "events", `ev_${Date.now().toString(36)}`), {
      stage: shipment.status,
      label: "Item reviewed and approved",
      loc: "",
      note: "Contents match the booking",
      kind: "review",
      ts: Date.now(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "approve_item",
      code,
      detail: "Approved shipment contents and photos",
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminFlagShipmentItem(params: {
  shipment: ShipmentRecord;
  reason: string;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const { shipment, reason, actorUid, actorEmail } = params;
  const code = shipment.code;
  const alertId = `al_${Date.now().toString(36)}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "shipments", code, "alerts", alertId), {
      to: "sender",
      kind: "item",
      title: "Item needs attention",
      message: reason.trim(),
      amount: 0,
      status: "open",
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "shipments", code), {
      review: {
        state: "flagged",
        note: reason.trim(),
        at: Date.now(),
        by: actorEmail,
      },
      hold: {
        type: "On Hold",
        reason: `Item review: ${reason.trim()}`,
        at: Date.now(),
        alertId,
      },
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "trackingTeasers", code), {
      holdType: "On Hold",
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "shipments", code, "events", `ev_${Date.now().toString(36)}`), {
      stage: shipment.status,
      label: "Item flagged during review",
      loc: "",
      note: reason.trim(),
      kind: "delay",
      ts: Date.now(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "flag_item",
      code,
      detail: reason.trim(),
    });

    await fetch("/api/shipments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        toEmail: shipment.senderEmail,
        recipientName: shipment.sender.name,
        senderFullName: shipment.sender.name,
        updateType: "action_required",
        headline: "Item needs attention",
        details: reason.trim(),
        hasAccount: true,
      }),
    }).catch(() => null);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminAddCheckpoint(params: {
  shipment: ShipmentRecord;
  stage: ShipmentStage;
  label: string;
  loc: string;
  note: string;
  ts: number;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const { shipment, stage, label, loc, note, ts, actorUid, actorEmail } = params;
  const code = shipment.code;
  try {
    const batch = writeBatch(db);
    const evId = `ev_${Date.now().toString(36)}`;
    batch.set(doc(db, "shipments", code, "events", evId), {
      stage,
      label: label.trim(),
      loc: loc.trim(),
      note: note.trim(),
      kind: "scan",
      ts,
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "shipments", code), {
      status: stage,
      nextStop: null,
      ...(stage === "Delivered" ? { deliveredAt: ts, hold: null } : {}),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "trackingTeasers", code), {
      status: stage,
      ...(stage === "Delivered" ? { deliveredAt: ts, holdType: null } : {}),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "add_checkpoint",
      code,
      detail: `${stage}: ${label.trim()} (${loc.trim()})`,
    });

    const receiverHasAccount = await checkAccountExists(shipment.receiverEmail);
    await fetch("/api/shipments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        toEmail: shipment.receiverEmail,
        recipientName: shipment.receiver.name,
        senderFullName: shipment.sender.name,
        updateType: stage === "Delivered" ? "delivered" : "checkpoint",
        headline: label.trim(),
        details: `${loc.trim()}${note.trim() ? ` — ${note.trim()}` : ""}`,
        hasAccount: receiverHasAccount,
      }),
    }).catch(() => null);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminSaveNextStop(params: {
  shipment: ShipmentRecord;
  label: string;
  loc: string;
  nextEta: number | null;
  deliveryEta: number;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const { shipment, label, loc, nextEta, deliveryEta, actorUid, actorEmail } =
    params;
  const code = shipment.code;
  try {
    const nextStop = label.trim()
      ? { label: label.trim(), loc: loc.trim(), eta: nextEta }
      : null;
    const batch = writeBatch(db);
    batch.update(doc(db, "shipments", code), {
      nextStop,
      eta: deliveryEta,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "trackingTeasers", code), {
      eta: deliveryEta,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "update_next_stop",
      code,
      detail: nextStop ? `Next: ${nextStop.label}` : "Updated delivery ETA",
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminSetHold(params: {
  shipment: ShipmentRecord;
  type: "Delayed" | "On Hold";
  reason: string;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const { shipment, type, reason, actorUid, actorEmail } = params;
  const code = shipment.code;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "shipments", code), {
      hold: { type, reason: reason.trim(), at: Date.now() },
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "trackingTeasers", code), {
      holdType: type,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "shipments", code, "events", `ev_${Date.now().toString(36)}`), {
      stage: shipment.status,
      label: type === "Delayed" ? "Shipment delayed" : "Shipment on hold",
      loc: "",
      note: reason.trim(),
      kind: "delay",
      ts: Date.now(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "flag_hold",
      code,
      detail: `${type}: ${reason.trim()}`,
    });

    const receiverHasAccount = await checkAccountExists(shipment.receiverEmail);
    await fetch("/api/shipments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        toEmail: shipment.receiverEmail,
        recipientName: shipment.receiver.name,
        senderFullName: shipment.sender.name,
        updateType: "delay",
        headline: type === "Delayed" ? "Shipment delayed" : "Shipment on hold",
        details: reason.trim(),
        hasAccount: receiverHasAccount,
      }),
    }).catch(() => null);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminClearHold(params: {
  shipment: ShipmentRecord;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const { shipment, actorUid, actorEmail } = params;
  const code = shipment.code;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "shipments", code), {
      hold: null,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "trackingTeasers", code), {
      holdType: null,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "shipments", code, "events", `ev_${Date.now().toString(36)}`), {
      stage: shipment.status,
      label: "Hold cleared",
      loc: "",
      note: "Shipment is moving again",
      kind: "info",
      ts: Date.now(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "clear_hold",
      code,
      detail: "Cleared hold/delay banner",
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminSendAlert(params: {
  shipment: ShipmentRecord;
  to: AlertTarget;
  kind: AlertKind;
  title: string;
  message: string;
  amount: number;
  holdShipment: boolean;
  actorUid: string;
  actorEmail: string;
}): Promise<void> {
  const {
    shipment,
    to,
    kind,
    title,
    message,
    amount,
    holdShipment,
    actorUid,
    actorEmail,
  } = params;
  const code = shipment.code;
  const alertId = `al_${Date.now().toString(36)}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "shipments", code, "alerts", alertId), {
      to,
      kind,
      title: title.trim(),
      message: message.trim(),
      amount: Number(amount || 0),
      status: "open",
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, "shipments", code, "events", `ev_${Date.now().toString(36)}`), {
      stage: shipment.status,
      label: `Action requested from ${to}`,
      loc: "",
      note: title.trim(),
      kind: "action",
      ts: Date.now(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
    if (holdShipment) {
      batch.update(doc(db, "shipments", code), {
        hold: {
          type: "On Hold",
          reason: `Waiting for ${to}: ${title.trim()}`,
          at: Date.now(),
          alertId,
        },
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "trackingTeasers", code), {
        holdType: "On Hold",
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "send_alert",
      code,
      detail: `Sent ${kind} alert to ${to}: ${title.trim()}`,
    });

    const targetEmail =
      to === "sender" ? shipment.senderEmail : shipment.receiverEmail;
    const targetName =
      to === "sender" ? shipment.sender.name : shipment.receiver.name;
    const hasAccount =
      to === "sender" ? true : await checkAccountExists(targetEmail);

    await fetch("/api/shipments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        toEmail: targetEmail,
        recipientName: targetName,
        senderFullName: shipment.sender.name,
        updateType: "action_required",
        headline: title.trim(),
        details: message.trim(),
        hasAccount,
      }),
    }).catch(() => null);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `shipments/${code}`);
  }
}

export async function adminUndoLastEvent(params: {
  shipment: ShipmentRecord;
  actorUid: string;
  actorEmail: string;
}): Promise<boolean> {
  const { shipment, actorUid, actorEmail } = params;
  const events = shipment.events || [];
  if (events.length <= 1) return false;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const nextStatus = STAGES.includes(prev.stage) ? prev.stage : shipment.status;

  try {
    await deleteDoc(doc(db, "shipments", shipment.code, "events", last.id));
    const batch = writeBatch(db);
    batch.update(doc(db, "shipments", shipment.code), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "trackingTeasers", shipment.code), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await logAdminAudit({
      actorUid,
      actorEmail,
      action: "undo_event",
      code: shipment.code,
      detail: `Removed event: ${last.label}`,
    });
    return true;
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `shipments/${shipment.code}/events/${last.id}`
    );
    return false;
  }
}

export async function adminResendReceiverInvite(params: {
  shipment: ShipmentRecord;
  actorUid: string;
  actorEmail: string;
  isReminder?: boolean;
}): Promise<{ status: string; subject?: string }> {
  const { shipment, actorUid, actorEmail, isReminder } = params;
  const receiverHasAccount = await checkAccountExists(shipment.receiverEmail);
  const res = await fetch("/api/invites/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: shipment.code,
      senderFullName: shipment.sender.name,
      senderEmail: shipment.senderEmail,
      receiverFullName: shipment.receiver.name,
      receiverEmail: shipment.receiverEmail,
      contents: shipment.contents,
      originCity: shipment.sender.city,
      originCountry: shipment.sender.country,
      destinationCity: shipment.receiver.city,
      destinationCountry: shipment.receiver.country,
      etaLabel: `by ${formatShortDay(shipment.eta)}`,
      totalFormatted: formatMoney(shipment.priceTotal),
      receiverHasAccount,
      isReminder: Boolean(isReminder),
      sendSenderReceipt: false,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Unable to send invite");
  }
  const existingCount = (shipment.invites || []).length;
  const invId = `inv_${Date.now().toString(36)}`;
  await setDoc(doc(db, "shipments", shipment.code, "invites", invId), {
    tokenHash: data.tokenHash,
    receiverEmail: shipment.receiverEmail,
    template: data.template,
    status: data.receiverEmailResult.status,
    emailCount: existingCount + 1,
    sentAt: Date.now(),
    createdBy: actorUid,
    createdAt: serverTimestamp(),
  });
  await logAdminAudit({
    actorUid,
    actorEmail,
    action: "resend_invite",
    code: shipment.code,
    detail: `Sent invite to ${shipment.receiverEmail}`,
  });
  return {
    status: data.receiverEmailResult.status,
    subject: data.receiverEmailResult.subject,
  };
}
