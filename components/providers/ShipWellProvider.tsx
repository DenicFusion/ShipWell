"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
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
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db, testConnection } from "@/lib/firebase";
import {
  applyThemeToDocument,
  getStoredThemePreference,
  normalizeThemePreference,
  resolveTheme,
  saveThemePreferenceLocal,
  subscribeSystemTheme,
} from "@/lib/theme";
import {
  ADMIN_EMAIL,
  normalizeEmail,
  type ResolvedTheme,
  type ShipmentAlert,
  type ShipmentRecord,
  type ThemePreference,
  type UserProfile,
} from "@/types/tracking";
import {
  syncUserProfileDoc,
  updateUserAccountProfile,
} from "@/lib/firestore-shipments";
import { AuthModal, type AuthModalOptions } from "@/components/modals/AuthModal";
import { ActionModal } from "@/components/modals/ActionModal";
import { PhotoZoomModal } from "@/components/modals/PhotoZoomModal";
import { ContactModal } from "@/components/modals/ContactModal";

interface ShipWellContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  isAdmin: boolean;
  openAlertsCount: number;
  unreadSupportCount: number;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setThemePreference: (pref: ThemePreference) => void;
  openAuth: (opts?: AuthModalOptions) => void;
  closeAuth: () => void;
  requireAuthForShip: (targetPath?: string) => void;
  openContact: (initialCode?: string) => void;
  closeContact: () => void;
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
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [hasAdminClaim, setHasAdminClaim] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [openAlertsCount, setOpenAlertsCount] = useState(0);
  const [rawUnreadSupportCount, setRawUnreadSupportCount] = useState(0);

  const [themePreference, setThemePrefState] = useState<ThemePreference>(() =>
    getStoredThemePreference()
  );
  const [systemResolvedTheme, setSystemResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system")
  );
  const resolvedTheme: ResolvedTheme =
    themePreference === "system"
      ? systemResolvedTheme
      : themePreference === "dark"
      ? "dark"
      : "light";

  const [authModalOpts, setAuthModalOpts] = useState<AuthModalOptions | null>(
    null
  );
  const [contactState, setContactState] = useState<{ initialCode?: string } | null>(
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
    hasAdminClaim ||
    (Boolean(user?.emailVerified) &&
      normalizeEmail(user?.email || "") === ADMIN_EMAIL);

  // Sync resolved theme to <html> and subscribe to OS theme changes when on "system"
  useEffect(() => {
    applyThemeToDocument(themePreference, false);
    if (themePreference !== "system") return;
    return subscribeSystemTheme((nextResolved) => {
      applyThemeToDocument("system", true);
      setSystemResolvedTheme(nextResolved);
    });
  }, [themePreference]);

  const setThemePreference = useCallback(
    (pref: ThemePreference) => {
      const normalized = normalizeThemePreference(pref);
      saveThemePreferenceLocal(normalized);
      applyThemeToDocument(normalized, true);
      setThemePrefState(normalized);

      const active = auth.currentUser;
      if (active) {
        updateUserAccountProfile({
          uid: active.uid,
          theme: normalized,
        }).catch(() => null);
      }
    },
    []
  );

  const refreshProfile = useCallback(async (u?: User | null) => {
    const active = u ?? auth.currentUser;
    if (!active) {
      setProfile(null);
      return;
    }
    try {
      const snap = await getDoc(doc(db, "users", active.uid));
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        setProfile(data);
        if (data.theme && (data.theme === "system" || data.theme === "dark" || data.theme === "light")) {
          saveThemePreferenceLocal(data.theme);
          setThemePrefState(data.theme);
        }
      } else if (active.email) {
        const localTheme = getStoredThemePreference();
        await syncUserProfileDoc({
          uid: active.uid,
          name: active.displayName || "ShipWell Customer",
          email: active.email,
          theme: localTheme !== "system" ? localTheme : undefined,
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
        try {
          const tokenRes = await u.getIdTokenResult();
          setHasAdminClaim(tokenRes.claims?.admin === true);
        } catch {
          setHasAdminClaim(false);
        }
        await refreshProfile(u);
        await refreshOpenAlerts(u);
      } else {
        setHasAdminClaim(false);
        setProfile(null);
        setOpenAlertsCount(0);
        setRawUnreadSupportCount(0);
      }
    });
    return () => unsub();
  }, [refreshProfile, refreshOpenAlerts]);

  // Live unread support badge listener
  useEffect(() => {
    if (!user) {
      return;
    }
    const cleanEmail = normalizeEmail(user.email || "");
    const uidUnread = new Map<string, boolean>();
    const emailUnread = new Map<string, boolean>();

    const recompute = () => {
      const combined = new Set<string>();
      uidUnread.forEach((flag, id) => {
        if (flag) combined.add(id);
      });
      emailUnread.forEach((flag, id) => {
        if (flag) combined.add(id);
      });
      setRawUnreadSupportCount(combined.size);
    };

    const unsubUid = onSnapshot(
      query(collection(db, "supportThreads"), where("uid", "==", user.uid)),
      (snap) => {
        uidUnread.clear();
        snap.docs.forEach((d) => {
          uidUnread.set(d.id, Boolean(d.data()?.unreadUser));
        });
        recompute();
      },
      () => undefined
    );

    const unsubEmail =
      user.emailVerified && cleanEmail
        ? onSnapshot(
            query(
              collection(db, "supportThreads"),
              where("userEmail", "==", cleanEmail)
            ),
            (snap) => {
              emailUnread.clear();
              snap.docs.forEach((d) => {
                emailUnread.set(d.id, Boolean(d.data()?.unreadUser));
              });
              recompute();
            },
            () => undefined
          )
        : () => undefined;

    return () => {
      unsubUid();
      unsubEmail();
    };
  }, [user]);

  // Re-check email verification when customer returns from verification link tab
  useEffect(() => {
    if (!user || user.emailVerified) return;
    const onFocus = async () => {
      try {
        await user.reload();
        if (user.emailVerified) {
          const tokenRes = await user.getIdTokenResult(true);
          setHasAdminClaim(tokenRes.claims?.admin === true);
          await refreshOpenAlerts(user);
        }
      } catch {
        // ignore transient errors
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, refreshOpenAlerts]);

  const openAuth = useCallback((opts: AuthModalOptions = {}) => {
    setAuthModalOpts({ mode: "login", ...opts });
  }, []);

  const closeAuth = useCallback(() => {
    setAuthModalOpts(null);
  }, []);

  const requireAuthForShip = useCallback(
    (targetPath = "/ship") => {
      if (auth.currentUser) {
        navigate(targetPath);
        return;
      }
      openAuth({
        mode: "login",
        prompt:
          "Log in or create a free account to ship a parcel. Your tracking number and the receiver link are kept on your account.",
        onDone: () => navigate(targetPath),
      });
    },
    [navigate, openAuth]
  );

  const openContact = useCallback((initialCode = "") => {
    setContactState({ initialCode });
  }, []);

  const closeContact = useCallback(() => {
    setContactState(null);
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
    setRawUnreadSupportCount(0);
  }, []);

  const unreadSupportCount = user ? rawUnreadSupportCount : 0;

  return (
    <ShipWellContext.Provider
      value={{
        user,
        profile,
        authReady,
        isAdmin,
        openAlertsCount,
        unreadSupportCount,
        themePreference,
        resolvedTheme,
        setThemePreference,
        openAuth,
        closeAuth,
        requireAuthForShip,
        openContact,
        closeContact,
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

      {contactState && (
        <ContactModal
          initialCode={contactState.initialCode}
          onClose={closeContact}
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
