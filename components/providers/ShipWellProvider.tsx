"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { auth, db, testConnection } from "@/lib/firebase";
import {
  ADMIN_EMAIL,
  normalizeEmail,
  type ShipmentAlert,
  type ShipmentRecord,
  type UserProfile,
} from "@/types/tracking";
import { syncUserProfileDoc } from "@/lib/firestore-shipments";
import { AuthModal, type AuthModalOptions } from "@/components/modals/AuthModal";
import { ActionModal } from "@/components/modals/ActionModal";
import { PhotoZoomModal } from "@/components/modals/PhotoZoomModal";

interface ShipWellContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  isAdmin: boolean;
  openAlertsCount: number;
  openAuth: (opts?: AuthModalOptions) => void;
  closeAuth: () => void;
  openAction: (
    shipment: ShipmentRecord,
    alert: ShipmentAlert,
    onResolved?: () => void
  ) => void;
  openPhotoZoom: (src: string, alt?: string) => void;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshOpenAlerts: () => Promise<void>;
}

const ShipWellContext = createContext<ShipWellContextValue | null>(null);

export function ShipWellProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [openAlertsCount, setOpenAlertsCount] = useState(0);

  const [authModalOpts, setAuthModalOpts] = useState<AuthModalOptions | null>(
    null
  );
  const [actionModalState, setActionModalState] = useState<{
    shipment: ShipmentRecord;
    alert: ShipmentAlert;
    onResolved?: () => void;
  } | null>(null);
  const [zoomState, setZoomState] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const isAdmin =
    Boolean(user?.emailVerified) &&
    normalizeEmail(user?.email || "") === ADMIN_EMAIL;

  const refreshProfile = useCallback(async (u?: User | null) => {
    const active = u ?? auth.currentUser;
    if (!active) {
      setProfile(null);
      return;
    }
    try {
      const snap = await getDoc(doc(db, "users", active.uid));
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      } else if (active.email) {
        await syncUserProfileDoc({
          uid: active.uid,
          name: active.displayName || "ShipWell Customer",
          email: active.email,
        });
        const retry = await getDoc(doc(db, "users", active.uid));
        if (retry.exists()) setProfile(retry.data() as UserProfile);
      }
    } catch (err) {
      console.warn("Profile read skipped:", err);
    }
  }, []);

  const refreshOpenAlerts = useCallback(async (u?: User | null) => {
    const active = u ?? auth.currentUser;
    if (!active || !active.email) {
      setOpenAlertsCount(0);
      return;
    }
    try {
      const cleanEmail = normalizeEmail(active.email);
      const docs: string[] = [];
      const sentSnap = await getDocs(
        query(collection(db, "shipments"), where("senderId", "==", active.uid))
      );
      sentSnap.forEach((d) => docs.push(d.id));
      if (active.emailVerified) {
        const incSnap = await getDocs(
          query(
            collection(db, "shipments"),
            where("receiverEmail", "==", cleanEmail)
          )
        );
        incSnap.forEach((d) => {
          if (!docs.includes(d.id)) docs.push(d.id);
        });
      }
      let openCount = 0;
      await Promise.all(
        docs.map(async (code) => {
          const alSnap = await getDocs(
            query(
              collection(db, "shipments", code, "alerts"),
              where("status", "==", "open")
            )
          );
          openCount += alSnap.size;
        })
      );
      setOpenAlertsCount(openCount);
    } catch {
      setOpenAlertsCount(0);
    }
  }, []);

  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        await refreshProfile(u);
        await refreshOpenAlerts(u);
      } else {
        setProfile(null);
        setOpenAlertsCount(0);
      }
    });
    return () => unsub();
  }, [refreshProfile, refreshOpenAlerts]);

  const openAuth = useCallback((opts: AuthModalOptions = {}) => {
    setAuthModalOpts({ mode: "login", ...opts });
  }, []);

  const closeAuth = useCallback(() => {
    setAuthModalOpts(null);
  }, []);

  const openAction = useCallback(
    (
      shipment: ShipmentRecord,
      alert: ShipmentAlert,
      onResolved?: () => void
    ) => {
      setActionModalState({ shipment, alert, onResolved });
    },
    []
  );

  const openPhotoZoom = useCallback((src: string, alt = "Item photo") => {
    setZoomState({ src, alt });
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
    setOpenAlertsCount(0);
  }, []);

  return (
    <ShipWellContext.Provider
      value={{
        user,
        profile,
        authReady,
        isAdmin,
        openAlertsCount,
        openAuth,
        closeAuth,
        openAction,
        openPhotoZoom,
        signOutUser,
        refreshProfile: () => refreshProfile(),
        refreshOpenAlerts: () => refreshOpenAlerts(),
      }}
    >
      {children}

      {authModalOpts && (
        <AuthModal
          options={authModalOpts}
          onClose={closeAuth}
          onAuthenticated={async (authedUser, isNew) => {
            await refreshProfile(authedUser);
            await refreshOpenAlerts(authedUser);
            const cb = authModalOpts.onDone;
            setAuthModalOpts(null);
            if (cb) cb(authedUser, isNew);
          }}
        />
      )}

      {actionModalState && user && (
        <ActionModal
          shipment={actionModalState.shipment}
          alert={actionModalState.alert}
          actorUid={user.uid}
          onClose={() => setActionModalState(null)}
          onResolved={async () => {
            const cb = actionModalState.onResolved;
            setActionModalState(null);
            await refreshOpenAlerts();
            if (cb) cb();
          }}
        />
      )}

      {zoomState && (
        <PhotoZoomModal
          src={zoomState.src}
          alt={zoomState.alt}
          onClose={() => setZoomState(null)}
        />
      )}
    </ShipWellContext.Provider>
  );
}

export function useShipWell() {
  const ctx = useContext(ShipWellContext);
  if (!ctx) {
    throw new Error("useShipWell must be used within ShipWellProvider");
  }
  return ctx;
}
