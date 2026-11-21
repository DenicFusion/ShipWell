import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { checkAccountExists } from "@/lib/firestore-shipments";
import { formatShortDay } from "@/lib/quote-engine";
import {
  firestoreTimeToMs,
  normalizeEmail,
  type ShipmentAlert,
  type ShipmentRecord,
  type TrackingEvent,
} from "@/types/tracking";

export function lastTsOf(s: ShipmentRecord): number {
  if (s.deliveredAt) return s.deliveredAt;
  const evs = s.events || [];
  if (evs.length > 0) {
    return evs[evs.length - 1].ts;
  }
  return s.createdAtMs || firestoreTimeToMs(s.createdAt);
}

export function getEtaSummary(s: ShipmentRecord): {
  k: string;
  v: string;
  sub: string;
} {
  if (s.status === "Delivered") {
    return {
      k: "Delivered",
      v: formatShortDay(lastTsOf(s)),
      sub: "Signed for",
    };
  }
  const diffDays = Math.ceil((s.eta - Date.now()) / 86400000);
  const delayed = s.hold?.type === "Delayed";
  return {
    k: delayed ? "Revised ETA" : "Estimated delivery",
    v: formatShortDay(s.eta),
    sub:
      diffDays > 1
        ? `in ${diffDays} days`
        : diffDays === 1
          ? "tomorrow"
          : diffDays === 0
            ? "today"
            : "update pending",
  };
}

export function myOpenAlertsForShipment(
  s: ShipmentRecord,
  userEmail?: string | null
): ShipmentAlert[] {
  const clean = normalizeEmail(userEmail || "");
  if (!clean) return [];
  const isReceiver =
    normalizeEmail(s.receiverEmail || s.receiver?.email) === clean;
  const isSender = normalizeEmail(s.senderEmail || s.sender?.email) === clean;
  return (s.alerts || []).filter(
    (a) =>
      a.status === "open" &&
      ((a.to === "receiver" && isReceiver) || (a.to === "sender" && isSender))
  );
}

export function uniqShipments(list: ShipmentRecord[]): ShipmentRecord[] {
  const seen = new Set<string>();
  const out: ShipmentRecord[] = [];
  for (const item of list) {
    if (!seen.has(item.code)) {
      seen.add(item.code);
      out.push(item);
    }
  }
  return out;
}

export function useDashboardShipments(params: {
  uid?: string | null;
  email?: string | null;
  emailVerified?: boolean;
}) {
  const uid = params.uid || "";
  const cleanEmail = normalizeEmail(params.email || "");
  const emailVerified = Boolean(params.emailVerified);
  const subKey = uid && cleanEmail ? `${uid}|${cleanEmail}|${emailVerified}` : "";

  const [sentState, setSentState] = useState<{
    key: string;
    docs: ShipmentRecord[];
  }>({ key: "", docs: [] });
  const [incomingState, setIncomingState] = useState<{
    key: string;
    docs: ShipmentRecord[];
  }>({ key: "", docs: [] });
  const [eventsMap, setEventsMap] = useState<Record<string, TrackingEvent[]>>({});
  const [alertsMap, setAlertsMap] = useState<Record<string, ShipmentAlert[]>>({});
  const [receiverStatusMap, setReceiverStatusMap] = useState<
    Record<string, boolean>
  >({});

  // Subscribe to top-level shipment docs for sender & verified receiver
  useEffect(() => {
    if (!subKey) return;

    const unsubSent = onSnapshot(
      query(collection(db, "shipments"), where("senderId", "==", uid)),
      (snap) => {
        const list: ShipmentRecord[] = snap.docs.map((d) => {
          const data = d.data() as ShipmentRecord;
          return {
            ...data,
            createdAtMs: firestoreTimeToMs(data.createdAt),
          };
        });
        setSentState({ key: subKey, docs: list });
      },
      () => {
        setSentState({ key: subKey, docs: [] });
      }
    );

    let unsubIncoming: Unsubscribe = () => undefined;
    if (emailVerified && cleanEmail) {
      unsubIncoming = onSnapshot(
        query(
          collection(db, "shipments"),
          where("receiverEmail", "==", cleanEmail)
        ),
        (snap) => {
          const list: ShipmentRecord[] = snap.docs.map((d) => {
            const data = d.data() as ShipmentRecord;
            return {
              ...data,
              createdAtMs: firestoreTimeToMs(data.createdAt),
            };
          });
          setIncomingState({ key: subKey, docs: list });
        },
        () => {
          setIncomingState({ key: subKey, docs: [] });
        }
      );
    }

    return () => {
      unsubSent();
      unsubIncoming();
    };
  }, [subKey, uid, cleanEmail, emailVerified]);

  const activeSentDocs = useMemo(
    () => (subKey && sentState.key === subKey ? sentState.docs : []),
    [subKey, sentState]
  );

  const activeIncomingDocs = useMemo(
    () =>
      subKey && emailVerified && incomingState.key === subKey
        ? incomingState.docs
        : [],
    [subKey, emailVerified, incomingState]
  );

  // Stable sorted list of unique shipment codes for subcollection subscriptions
  const codeKey = useMemo(() => {
    const codes = Array.from(
      new Set([...activeSentDocs, ...activeIncomingDocs].map((s) => s.code))
    ).sort();
    return codes.join(",");
  }, [activeSentDocs, activeIncomingDocs]);

  useEffect(() => {
    if (!codeKey) return;
    const codes = codeKey.split(",").filter(Boolean);
    const unsubs: Unsubscribe[] = [];

    for (const code of codes) {
      unsubs.push(
        onSnapshot(
          query(collection(db, "shipments", code, "events"), orderBy("ts", "asc")),
          (snap) => {
            const evs: TrackingEvent[] = snap.docs.map((d) => ({
              ...(d.data() as Omit<TrackingEvent, "id">),
              id: d.id,
            }));
            setEventsMap((prev) => ({ ...prev, [code]: evs }));
          },
          () => undefined
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, "shipments", code, "alerts"),
          (snap) => {
            const als: ShipmentAlert[] = snap.docs.map((d) => {
              const raw = d.data() as Omit<ShipmentAlert, "id">;
              return {
                ...raw,
                id: d.id,
                createdAtMs: firestoreTimeToMs(raw.createdAt),
                resolvedAtMs: raw.resolvedAt
                  ? firestoreTimeToMs(raw.resolvedAt)
                  : undefined,
              };
            });
            setAlertsMap((prev) => ({ ...prev, [code]: als }));
          },
          () => undefined
        )
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [codeKey]);

  // Lookup receiver account existence for sent shipments
  const sentEmailsKey = useMemo(() => {
    return Array.from(
      new Set(
        activeSentDocs
          .map((s) => normalizeEmail(s.receiverEmail))
          .filter(Boolean)
      )
    )
      .sort()
      .join(",");
  }, [activeSentDocs]);

  useEffect(() => {
    if (!sentEmailsKey) return;
    let cancelled = false;
    const emails = sentEmailsKey.split(",").filter(Boolean);
    Promise.all(
      emails.map(async (em) => [em, await checkAccountExists(em)] as const)
    ).then((pairs) => {
      if (!cancelled) {
        setReceiverStatusMap(Object.fromEntries(pairs));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sentEmailsKey]);

  const sent = useMemo<ShipmentRecord[]>(() => {
    return activeSentDocs
      .map((s) => ({
        ...s,
        events: eventsMap[s.code] || [],
        alerts: alertsMap[s.code] || [],
      }))
      .sort((a, b) => lastTsOf(b) - lastTsOf(a));
  }, [activeSentDocs, eventsMap, alertsMap]);

  const incoming = useMemo<ShipmentRecord[]>(() => {
    return activeIncomingDocs
      .map((s) => ({
        ...s,
        events: eventsMap[s.code] || [],
        alerts: alertsMap[s.code] || [],
      }))
      .sort((a, b) => lastTsOf(b) - lastTsOf(a));
  }, [activeIncomingDocs, eventsMap, alertsMap]);

  const allUnique = useMemo(
    () => uniqShipments([...incoming, ...sent]),
    [incoming, sent]
  );

  const alertsList = useMemo(() => {
    const items: { shipment: ShipmentRecord; alert: ShipmentAlert }[] = [];
    for (const s of allUnique) {
      const isRec =
        emailVerified &&
        normalizeEmail(s.receiverEmail || s.receiver?.email) === cleanEmail;
      const isSnd =
        s.senderId === uid ||
        normalizeEmail(s.senderEmail || s.sender?.email) === cleanEmail;

      for (const a of s.alerts || []) {
        if ((a.to === "receiver" && isRec) || (a.to === "sender" && isSnd)) {
          items.push({ shipment: s, alert: a });
        }
      }
    }
    items.sort(
      (a, b) => (b.alert.createdAtMs || 0) - (a.alert.createdAtMs || 0)
    );
    return items;
  }, [allUnique, cleanEmail, emailVerified, uid]);

  const openAlerts = useMemo(
    () => alertsList.filter((x) => x.alert.status === "open"),
    [alertsList]
  );

  const resolvedAlerts = useMemo(
    () => alertsList.filter((x) => x.alert.status === "resolved"),
    [alertsList]
  );

  const loading = Boolean(subKey) && (
    sentState.key !== subKey ||
    (emailVerified && incomingState.key !== subKey)
  );

  return {
    loading,
    incoming,
    sent,
    allUnique,
    receiverStatusMap,
    alertsList,
    openAlerts,
    resolvedAlerts,
  };
}

interface TeaserSummary {
  code: string;
  status: ShipmentRecord["status"];
  holdType?: string | null;
  originCity: string;
  originCountry: string;
  destinationCity: string;
  destinationCountry: string;
  service: ShipmentRecord["service"];
  weightKg: number;
  contents: string;
  eta: number;
  deliveredAt?: number | null;
  latestEvent?: { label: string; loc: string; ts: number } | null;
}

export function useTrackedShipmentLive(params: {
  code: string;
  uid?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  isAdmin?: boolean;
}) {
  const code = params.code.trim().toUpperCase();
  const uid = params.uid || "";
  const reqKey = code ? `${code}|${uid}` : "";

  const [snapState, setSnapState] = useState<{
    key: string;
    accessMode: "none" | "full" | "public" | "not_found";
    shipment: ShipmentRecord | null;
    teaser: TeaserSummary | null;
  }>({
    key: "",
    accessMode: "none",
    shipment: null,
    teaser: null,
  });

  const [eventsState, setEventsState] = useState<{
    key: string;
    items: TrackingEvent[];
  }>({ key: "", items: [] });

  const [alertsState, setAlertsState] = useState<{
    key: string;
    items: ShipmentAlert[];
  }>({ key: "", items: [] });

  useEffect(() => {
    if (!code) return;

    let unsubEvents: Unsubscribe = () => undefined;
    let unsubAlerts: Unsubscribe = () => undefined;
    let unsubTeaser: Unsubscribe = () => undefined;
    let cancelled = false;

    const subscribeTeaserFallback = () => {
      unsubTeaser = onSnapshot(
        doc(db, "trackingTeasers", code),
        (snap) => {
          if (cancelled) return;
          if (!snap.exists()) {
            setSnapState({
              key: reqKey,
              accessMode: "not_found",
              shipment: null,
              teaser: null,
            });
          } else {
            setSnapState({
              key: reqKey,
              accessMode: "public",
              shipment: null,
              teaser: snap.data() as TeaserSummary,
            });
          }
        },
        () => {
          if (cancelled) return;
          setSnapState({
            key: reqKey,
            accessMode: "not_found",
            shipment: null,
            teaser: null,
          });
        }
      );
    };

    const unsubShip = onSnapshot(
      doc(db, "shipments", code),
      (snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          subscribeTeaserFallback();
          return;
        }
        const raw = snap.data() as ShipmentRecord;
        setSnapState({
          key: reqKey,
          accessMode: "full",
          shipment: {
            ...raw,
            createdAtMs: firestoreTimeToMs(raw.createdAt),
          },
          teaser: null,
        });
      },
      () => {
        if (cancelled) return;
        subscribeTeaserFallback();
      }
    );

    if (uid) {
      unsubEvents = onSnapshot(
        query(collection(db, "shipments", code, "events"), orderBy("ts", "asc")),
        (snap) => {
          if (cancelled) return;
          setEventsState({
            key: reqKey,
            items: snap.docs.map((d) => ({
              ...(d.data() as Omit<TrackingEvent, "id">),
              id: d.id,
            })),
          });
        },
        () => undefined
      );

      unsubAlerts = onSnapshot(
        collection(db, "shipments", code, "alerts"),
        (snap) => {
          if (cancelled) return;
          setAlertsState({
            key: reqKey,
            items: snap.docs.map((d) => {
              const a = d.data() as Omit<ShipmentAlert, "id">;
              return {
                ...a,
                id: d.id,
                createdAtMs: firestoreTimeToMs(a.createdAt),
                resolvedAtMs: a.resolvedAt
                  ? firestoreTimeToMs(a.resolvedAt)
                  : undefined,
              };
            }),
          });
        },
        () => undefined
      );
    }

    return () => {
      cancelled = true;
      unsubShip();
      unsubEvents();
      unsubAlerts();
      unsubTeaser();
    };
  }, [code, uid, reqKey]);

  const loading = Boolean(code) && snapState.key !== reqKey;
  const activeMode =
    !code || snapState.key !== reqKey ? "none" : snapState.accessMode;

  const fullBundle = useMemo<ShipmentRecord | null>(() => {
    if (!code || snapState.key !== reqKey || !snapState.shipment) return null;
    return {
      ...snapState.shipment,
      events: eventsState.key === reqKey ? eventsState.items : [],
      alerts: alertsState.key === reqKey ? alertsState.items : [],
    };
  }, [code, reqKey, snapState, eventsState, alertsState]);

  return {
    loading,
    accessMode: activeMode,
    shipment: fullBundle,
    teaser:
      code && snapState.key === reqKey ? snapState.teaser : null,
  };
}
