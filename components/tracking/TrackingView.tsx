import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  Check,
  Clock,
  Copy,
  Lock,
  Mail,
  Plane,
  Search,
  Shield,
  Truck,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { CustomsLedger } from "@/components/tracking/CustomsLedger";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
import {
  checkAccountExists,
  fetchFullShipmentBundleWithRetry,
  fetchTrackingTeaser,
} from "@/lib/firestore-shipments";
import { formatDateTime, formatShortDay, SERVICES } from "@/lib/quote-engine";
import {
  formatTrackingCode,
  getShipmentChip,
  getStagePercent,
  isValidTrackingCode,
  normalizeEmail,
  type ManualPaymentRecord,
  type ShipmentAlert,
  type ShipmentRecord,
  type TrackingEvent,
  type TrackingTeaser,
} from "@/types/tracking";
import toast from "react-hot-toast";

interface InviteVerification {
  valid: boolean;
  expired?: boolean;
  reason?: string;
  code?: string;
  receiverEmail?: string;
  maskedEmail?: string;
  receiverFirstName?: string;
  senderFullName?: string;
}

const RECENT_KEY = "sw_recent_tracks";

export function TrackingView({ initialCode = "" }: { initialCode?: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite") || "";

  const {
    user,
    authReady,
    isAdmin,
    openAuth,
    openAction,
    openPhotoZoom,
    signOutUser,
  } = useShipWell();

  const normalizedInitial = formatTrackingCode(initialCode);
  const [inputCode, setInputCode] = useState(normalizedInitial);
  const [recentCodes, setRecentCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(
    Boolean(normalizedInitial && isValidTrackingCode(normalizedInitial))
  );
  const [teaser, setTeaser] = useState<TrackingTeaser | null>(null);
  const [shipment, setShipment] = useState<ShipmentRecord | null>(null);
  const [receiverHasAccount, setReceiverHasAccount] = useState<boolean>(false);
  const [inviteLookup, setInviteLookup] = useState<{
    token: string;
    data: InviteVerification;
  } | null>(null);
  const inviteInfo =
    inviteToken && inviteLookup?.token === inviteToken ? inviteLookup.data : null;
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const [verifyingBusy, setVerifyingBusy] = useState(false);
  const [bookingManualPay, setBookingManualPay] =
    useState<ManualPaymentRecord | null>(null);

  useEffect(() => {
    if (verifyCooldown <= 0) return;
    const t = window.setInterval(
      () => setVerifyCooldown((prev) => Math.max(0, prev - 1)),
      1000
    );
    return () => window.clearInterval(t);
  }, [verifyCooldown]);

  // Normalize URL if lowercase/unformatted code was visited directly
  useEffect(() => {
    if (initialCode && normalizedInitial && initialCode !== normalizedInitial) {
      const qs = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : "";
      navigate(`/track/${normalizedInitial}${qs}`, { replace: true });
    }
  }, [initialCode, normalizedInitial, inviteToken, navigate]);

  // Load recent session searches asynchronously to preserve SSR hydration & satisfy hooks lint
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]");
        if (Array.isArray(saved)) {
          setRecentCodes(saved.filter((x) => typeof x === "string").slice(0, 5));
        }
      } catch {
        // ignore storage failure
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const saveRecent = useCallback((code: string) => {
    if (!isValidTrackingCode(code)) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]");
      const list = Array.isArray(saved) ? saved : [];
      const next = [code, ...list.filter((c: string) => c !== code)].slice(0, 5);
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecentCodes(next);
    } catch {
      // ignore storage failure
    }
  }, []);

  // Verify ?invite= token if present
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    fetch("/api/invites/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteToken,
        code: normalizedInitial || undefined,
      }),
    })
      .then((r) => r.json())
      .then((data: InviteVerification) => {
        if (!cancelled) setInviteLookup({ token: inviteToken, data });
      })
      .catch(() => {
        if (!cancelled) {
          setInviteLookup({
            token: inviteToken,
            data: { valid: false, expired: false },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken, normalizedInitial]);

  const loadTrackingData = useCallback(async () => {
    if (!normalizedInitial || !isValidTrackingCode(normalizedInitial)) {
      return;
    }

    try {
      const t = await fetchTrackingTeaser(normalizedInitial);
      setTeaser(t);
      if (t) {
        saveRecent(normalizedInitial);
        if (user) {
          const full = await fetchFullShipmentBundleWithRetry(normalizedInitial, 3);
          setShipment(full);
          if (full?.receiverEmail) {
            const exists = await checkAccountExists(full.receiverEmail);
            setReceiverHasAccount(exists);
          }
          if (
            full &&
            (full.paymentId ||
              (full.paymentStatus &&
                full.paymentStatus !== "paid" &&
                full.paymentStatus !== "pay_on_pickup"))
          ) {
            user
              .getIdToken()
              .then((token) =>
                apiFetch<{ ok: boolean; payments: ManualPaymentRecord[] }>(
                  `/api/payments/my?code=${encodeURIComponent(normalizedInitial)}`,
                  {
                    headers: { Authorization: `Bearer ${token}` },
                    step: "public_track_load_payment",
                  }
                )
              )
              .then((res) => {
                const found =
                  (res.payments || []).find((p) => p.kind === "booking") || null;
                setBookingManualPay(found);
              })
              .catch(() => undefined);
          } else {
            setBookingManualPay(null);
          }
        } else {
          setShipment(null);
          setBookingManualPay(null);
        }
      } else {
        setShipment(null);
        setBookingManualPay(null);
      }
    } finally {
      setLoading(false);
    }
  }, [normalizedInitial, user, saveRecent]);

  useEffect(() => {
    if (authReady) {
      loadTrackingData();
    }
  }, [authReady, loadTrackingData]);

  // Refresh verification state if user returns after clicking verification email
  useEffect(() => {
    if (!user || user.emailVerified) return;
    const onFocus = async () => {
      try {
        await user.reload();
        if (user.emailVerified) {
          await user.getIdToken(true);
          await loadTrackingData();
        }
      } catch {
        // ignore transient network errors
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, loadTrackingData]);

  // Live Firestore subscription when user has access to full shipment
  useEffect(() => {
    if (!user || !shipment?.code) return;
    const code = shipment.code;

    const unsubShip = onSnapshot(
      doc(db, "shipments", code),
      (snap) => {
        if (snap.exists()) {
          setShipment((prev) =>
            prev ? { ...prev, ...(snap.data() as ShipmentRecord) } : null
          );
        }
      },
      () => undefined
    );

    const unsubEvents = onSnapshot(
      query(collection(db, "shipments", code, "events"), orderBy("ts", "asc")),
      (snap) => {
        const events: TrackingEvent[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<TrackingEvent, "id">),
          id: d.id,
        }));
        setShipment((prev) => (prev ? { ...prev, events } : null));
      },
      () => undefined
    );

    const unsubAlerts = onSnapshot(
      collection(db, "shipments", code, "alerts"),
      (snap) => {
        const alerts: ShipmentAlert[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<ShipmentAlert, "id">),
          id: d.id,
        }));
        setShipment((prev) => (prev ? { ...prev, alerts } : null));
      },
      () => undefined
    );

    return () => {
      unsubShip();
      unsubEvents();
      unsubAlerts();
    };
  }, [user, shipment?.code]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = formatTrackingCode(inputCode);
    if (!formatted) {
      toast("Enter a ShipWell tracking number (e.g. SW-20260531-A8F4B2C1)");
      return;
    }
    navigate(`/track/${formatted}`);
  };

  const handleExpiredResend = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeEmail(resendEmail);
    if (!clean.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    setResendSent(true);
    toast.success("If that email matches the parcel recipient, you can sign in directly below.");
    openAuth({
      mode: "signup",
      prefillEmail: clean,
      trackingCode: normalizedInitial,
      prompt: `Create an account or sign in with ${clean} to view ${normalizedInitial}.`,
    });
  };

  const renderViewerOutput = () => {
    if (!normalizedInitial) return null;

    if (!isValidTrackingCode(normalizedInitial)) {
      return (
        <div className="tcard">
          <div className="nf">
            <div className="x">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3>CHECK THE NUMBER</h3>
            <p>
              ShipWell tracking numbers use the format{" "}
              <code>SW-YYYYMMDD-XXXXXXXX</code> (e.g.{" "}
              <code>SW-20260531-A8F4B2C1</code>).
            </p>
            <p style={{ marginTop: 10 }}>
              Entered: <code>{normalizedInitial}</code>
            </p>
          </div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="tcard">
          <div className="nf">
            <p>Looking up {normalizedInitial}...</p>
          </div>
        </div>
      );
    }

    if (!teaser) {
      return (
        <div className="tcard">
          <div className="nf">
            <div className="x">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3>NO SHIPMENT FOUND</h3>
            <p>
              We couldn&apos;t find a shipment matching{" "}
              <code>{normalizedInitial}</code>. Double-check the characters and
              try again.
            </p>
          </div>
        </div>
      );
    }

    const chip = getShipmentChip({
      status: shipment?.status || teaser.status,
      hold: shipment?.hold,
      holdType: teaser.holdType,
    });
    const pct = getStagePercent(shipment?.status || teaser.status);
    const originCity = shipment?.sender.city || teaser.originCity;
    const originCountry = shipment?.sender.country || teaser.originCountry;
    const destCity = shipment?.receiver.city || teaser.destinationCity;
    const destCountry =
      shipment?.receiver.country || teaser.destinationCountry;

    // ── ANONYMOUS GATE ──────────────────────────────────────────────
    if (!user) {
      const validInvite = Boolean(inviteInfo?.valid && inviteInfo.receiverEmail);
      const expiredInvite = Boolean(inviteInfo?.expired);
      const delivered = teaser.status === "Delivered";
      const latestLabel = teaser.latestEvent?.label || chip.label;
      const latestLoc =
        teaser.latestEvent?.loc || `${originCity}, ${originCountry}`;
      const latestTs = teaser.latestEvent?.ts;

      return (
        <div className="tcard">
          <div className="tc-h">
            <div>
              <small>Tracking number</small>
              <div className="tcode">
                {normalizedInitial}
                <button
                  type="button"
                  className="cp"
                  aria-label="Copy tracking number"
                  onClick={() => {
                    navigator.clipboard.writeText(normalizedInitial);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>

          <div className="rbar">
            <div className="rc">
              <b>{originCity}</b>
              <small>{originCountry}</small>
            </div>
            <div className="rt">
              <i style={{ width: `${pct}%` }} />
              <b style={{ left: `${pct}%` }}>
                {delivered ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Plane className="w-4 h-4" />
                )}
              </b>
            </div>
            <div className="rc r">
              <b>{destCity}</b>
              <small>{destCountry}</small>
            </div>
          </div>

          <div className="tm">
            <div>
              <small>Service</small>
              <b>{SERVICES[teaser.service]?.name}</b>
            </div>
            <div>
              <small>Weight</small>
              <b>{teaser.weightKg.toFixed(1)} kg</b>
            </div>
            <div>
              <small>Status</small>
              <b>{chip.label}</b>
            </div>
            <div>
              <small>{delivered ? "Delivered" : "Est. delivery"}</small>
              <b style={{ color: "var(--em)" }}>
                {delivered && teaser.deliveredAt
                  ? formatShortDay(teaser.deliveredAt)
                  : `by ${formatShortDay(teaser.eta)}`}
              </b>
            </div>
          </div>

          <div className="tk-sec">
            <h6>Latest update</h6>
            <div className="ev active">
              <div className="dot">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#04120C",
                  }}
                />
              </div>
              <div className="evc">
                <div className="evt">
                  <b>{latestLabel}</b>
                  {latestTs ? <time>{formatDateTime(latestTs)}</time> : null}
                </div>
                <small>{latestLoc}</small>
              </div>
            </div>
          </div>

          <div className="tk-sec">
            <div
              className="gt-box"
              style={{ margin: "6px 0 4px", position: "static", maxWidth: "none" }}
            >
              <div className="au-ic">
                <Lock className="w-6 h-6" />
              </div>

              {expiredInvite ? (
                <>
                  <h3>THIS LINK HAS EXPIRED</h3>
                  <p>
                    This link has expired — enter your email and we&apos;ll send
                    a new one or open your sign-up right away.
                  </p>
                  <form
                    onSubmit={handleExpiredResend}
                    style={{ display: "grid", gap: 10 }}
                  >
                    <input
                      className="field"
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@email.com"
                      required
                    />
                    <button type="submit" className="sw-btn sw-btn-em">
                      <Mail className="w-4 h-4" />
                      {resendSent ? "Continue to sign up" : "Send new link & continue"}
                    </button>
                  </form>
                </>
              ) : validInvite ? (
                <>
                  <h3>
                    WELCOME,{" "}
                    {(inviteInfo?.receiverFirstName || "FRIEND").toUpperCase()}
                  </h3>
                  <p>
                    Welcome, {inviteInfo?.receiverFirstName} — create your
                    account to see <b>{normalizedInitial}</b> ({teaser.contents}{" "}
                    from {inviteInfo?.senderFullName}).
                  </p>
                  <div className="row2">
                    <button
                      type="button"
                      className="sw-btn sw-btn-em sw-btn-lg"
                      onClick={() =>
                        openAuth({
                          mode: "signup",
                          prefillEmail: inviteInfo?.receiverEmail,
                          prefillName: inviteInfo?.receiverFirstName,
                          lockEmail: true,
                          trackingCode: normalizedInitial,
                          prompt: `Welcome, ${inviteInfo?.receiverFirstName} — create your account to see ${normalizedInitial}.`,
                        })
                      }
                    >
                      Create free account
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost sw-btn-lg"
                      onClick={() =>
                        openAuth({
                          mode: "login",
                          prefillEmail: inviteInfo?.receiverEmail,
                          lockEmail: true,
                          trackingCode: normalizedInitial,
                          prompt: `Sign in with ${inviteInfo?.receiverEmail} to view ${normalizedInitial}.`,
                        })
                      }
                    >
                      Log in
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3>LOG IN FOR MORE UPDATES</h3>
                  <p>
                    Every checkpoint, item photos and delivery alerts are
                    available to registered users. It&apos;s free.
                  </p>
                  <div className="row2">
                    <button
                      type="button"
                      className="sw-btn sw-btn-em sw-btn-lg"
                      onClick={() =>
                        openAuth({
                          mode: "login",
                          trackingCode: normalizedInitial,
                          prompt: `Log in or create a free account to see the full progress of ${normalizedInitial}.`,
                        })
                      }
                    >
                      Log in
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost sw-btn-lg"
                      onClick={() =>
                        openAuth({
                          mode: "signup",
                          trackingCode: normalizedInitial,
                          prompt: `Log in or create a free account to see the full progress of ${normalizedInitial}.`,
                        })
                      }
                    >
                      Create free account
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ── LOGGED IN MISMATCH CHECK AGAINST INVITE EMAIL ──────────────
    const cleanUserEmail = normalizeEmail(user.email || "");
    const inviteMismatch =
      inviteInfo?.valid &&
      inviteInfo.receiverEmail &&
      cleanUserEmail !== normalizeEmail(inviteInfo.receiverEmail);

    const isSender = shipment?.senderId === user.uid;
    const isReceiver =
      Boolean(user.emailVerified) &&
      shipment?.receiverEmail === cleanUserEmail;
    const viewerRole: "admin" | "receiver" | "sender" | "public" = isAdmin
      ? "admin"
      : isReceiver
        ? "receiver"
        : isSender
          ? "sender"
          : "public";

    const canSeePrivate =
      shipment !== null &&
      (viewerRole === "admin" ||
        viewerRole === "sender" ||
        viewerRole === "receiver");

    const openAlertsForViewer = (shipment?.alerts || []).filter(
      (a) =>
        a.status === "open" &&
        (viewerRole === "admin" || a.to === viewerRole)
    );

    const sortedEvents = [...(shipment?.events || [])].sort(
      (a, b) => b.ts - a.ts
    );

    return (
      <div className="tcard">
        <div className="tc-h">
          <div>
            <small>Tracking Number</small>
            <div className="tcode">
              {normalizedInitial}
              <button
                type="button"
                className="cp"
                aria-label="Copy tracking number"
                onClick={() => {
                  navigator.clipboard.writeText(normalizedInitial);
                  toast.success("Tracking number copied");
                }}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <span className={`chip ${chip.tone}`}>{chip.label}</span>
        </div>

        {inviteMismatch && (
          <div className="tk-hold a">
            <AlertTriangle className="w-5 h-5 hi shrink-0" />
            <div className="flex-1">
              <b>Signed in with a different email</b>
              <small>
                This parcel was sent to <b>{inviteInfo?.maskedEmail}</b>. Sign
                in with that email to see it.
              </small>
            </div>
            <button
              type="button"
              className="sw-btn sw-btn-amber"
              style={{ padding: "8px 14px", fontSize: 12.5 }}
              onClick={async () => {
                await signOutUser();
                openAuth({
                  mode: "login",
                  prefillEmail: inviteInfo?.receiverEmail,
                  lockEmail: true,
                  trackingCode: normalizedInitial,
                });
              }}
            >
              Switch account
            </button>
          </div>
        )}

        {!user.emailVerified && !isSender && !isAdmin && (
          <div className="tk-hold a">
            <Mail className="w-5 h-5 hi shrink-0" />
            <div className="flex-1">
              <b>Verify your email address</b>
              <small>
                If this parcel was sent to <b>{user.email}</b>, verify your
                email address to unlock photos and live recipient details.
              </small>
            </div>
            <button
              type="button"
              disabled={verifyingBusy || verifyCooldown > 0}
              className="sw-btn sw-btn-amber"
              style={{ padding: "8px 14px", fontSize: 12.5 }}
              onClick={async () => {
                setVerifyingBusy(true);
                try {
                  const idToken = await user.getIdToken();
                  await apiFetch("/api/auth/send-verification", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({}),
                    step: "tracking_send_verification",
                  });
                  setVerifyCooldown(60);
                  toast.success("Verification email sent — check your inbox.");
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Could not send verification email right now."
                  );
                } finally {
                  setVerifyingBusy(false);
                }
              }}
            >
              {verifyCooldown > 0
                ? `Resend in ${verifyCooldown}s`
                : "Send verification email"}
            </button>
          </div>
        )}

        {/* ROLE BAR */}
        <div className="tk-role">
          <Shield className="w-4 h-4 text-[var(--em)] shrink-0" />
          {viewerRole === "admin" ? (
            <span>
              <b>Admin view</b> — operations access enabled
            </span>
          ) : viewerRole === "receiver" && shipment ? (
            <span>
              You are the <b>recipient</b> — this parcel is on its way to you
              from {shipment.sender.name} ({shipment.sender.city}).
            </span>
          ) : viewerRole === "sender" && shipment ? (
            <span>
              You are the <b>sender</b> —{" "}
              {receiverHasAccount
                ? `${shipment.receiver.email} can follow this parcel live.`
                : `waiting for ${shipment.receiver.email} to sign up.`}
            </span>
          ) : (
            <span>
              Signed in as <b>{user.email}</b> — route status summary.
            </span>
          )}
        </div>

        {/* DELAY OR HOLD BANNER */}
        {shipment?.hold && (
          <div
            className={`tk-hold ${shipment.hold.type === "Delayed" ? "a" : "r"}`}
          >
            <AlertTriangle className="w-5 h-5 hi shrink-0" />
            <div>
              <b>{shipment.hold.type}</b>
              <small>{shipment.hold.reason}</small>
            </div>
          </div>
        )}

        {/* ACTION REQUIRED BANNERS */}
        {openAlertsForViewer.map((alert) => (
          <div className="al-banner" key={alert.id}>
            <div className="ai">
              <AlertCircle className="w-[19px] h-[19px]" />
            </div>
            <div className="t">
              <b>{alert.title}</b>
              <small>{alert.message}</small>
            </div>
            {shipment && (
              <button
                type="button"
                className="sw-btn sw-btn-blue"
                onClick={() => openAction(shipment, alert, loadTrackingData)}
              >
                Take action
              </button>
            )}
          </div>
        ))}

        {/* ROUTE BAR */}
        <div className="rbar">
          <div className="rc">
            <b>{originCity}</b>
            <small>{originCountry}</small>
          </div>
          <div className="rt">
            <i style={{ width: `${pct}%` }} />
            <b style={{ left: `${pct}%` }}>
              <Plane className="w-4 h-4" />
            </b>
          </div>
          <div className="rc r">
            <b>{destCity}</b>
            <small>{destCountry}</small>
          </div>
        </div>

        {/* META GRID */}
        <div className="tm">
          <div>
            <small>Service</small>
            <b>{SERVICES[shipment?.service || teaser.service]?.name}</b>
          </div>
          <div>
            <small>Weight</small>
            <b>{(shipment?.weightKg ?? teaser.weightKg).toFixed(1)} kg</b>
          </div>
          <div>
            <small>Contents</small>
            <b>{shipment?.contents || teaser.contents}</b>
          </div>
          <div>
            <small>
              {(shipment?.status || teaser.status) === "Delivered"
                ? "Delivered"
                : shipment?.hold
                  ? "Revised ETA"
                  : "Estimated arrival"}
            </small>
            <b>
              {shipment?.deliveredAt
                ? formatShortDay(shipment.deliveredAt)
                : `by ${formatShortDay(shipment?.eta || teaser.eta)}`}
            </b>
          </div>
        </div>

        {/* ITEM PHOTOS (SENDER, RECEIVER & ADMIN ONLY) */}
        <div className="tk-sec">
          <h6>
            <Camera className="w-3.5 h-3.5" />
            Item photos{" "}
            {canSeePrivate && shipment?.photos?.length ? (
              <i>
                {shipment.photos.length} uploaded · tap to zoom
              </i>
            ) : null}
          </h6>
          {canSeePrivate && shipment ? (
            shipment.photos && shipment.photos.length > 0 ? (
              <div className="gal">
                {shipment.photos.map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`Zoom item photo ${idx + 1}`}
                    onClick={() => openPhotoZoom(src, `${shipment.contents} (${idx + 1})`)}
                  >
                    <img src={src} alt={`Item ${idx + 1}`} />
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                No photos attached to this shipment.
              </p>
            )
          ) : (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Photos and private delivery details are only visible to the sender
              and the receiver.
            </p>
          )}
        </div>

        {/* MANUAL BOOKING PAYMENT PANEL */}
        {canSeePrivate &&
          shipment &&
          bookingManualPay &&
          bookingManualPay.status !== "paid" &&
          shipment.paymentStatus !== "pay_on_pickup" && (
            <div className="tk-sec">
              <ManualPaymentPanel
                payment={bookingManualPay}
                onUpdated={(next) => setBookingManualPay(next)}
              />
            </div>
          )}

        {/* DUTIES & CHARGES (BACHS & CUSTOM METHODS) */}
        {canSeePrivate &&
          shipment &&
          (shipment.alerts || []).some((a) => a.kind === "duty") && (
            <div className="tk-sec">
              <CustomsLedger
                shipment={shipment}
                viewerRole={viewerRole}
                isAdmin={isAdmin}
              />
            </div>
          )}

        {/* LIVE TIMELINE */}
        {canSeePrivate && (
          <div className="tl">
            <h6>Tracking history</h6>
            {shipment?.nextStop?.label && shipment.status !== "Delivered" && (
              <div className="ev pending next">
                <div className="dot">
                  <Clock className="w-3 h-3" />
                </div>
                <div className="evc">
                  <div className="evt">
                    <b>Up next: {shipment.nextStop.label}</b>
                    {shipment.nextStop.eta && (
                      <time>Est. {formatDateTime(shipment.nextStop.eta)}</time>
                    )}
                  </div>
                  {shipment.nextStop.loc && (
                    <small>{shipment.nextStop.loc}</small>
                  )}
                </div>
              </div>
            )}

            {sortedEvents.map((ev, idx) => {
              const isNewest = idx === 0 && !shipment?.nextStop?.label;
              const cls = [
                "ev",
                isNewest ? "active" : "done",
                ev.kind === "delay"
                  ? "k-delay"
                  : ev.kind === "action"
                    ? "k-action"
                    : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div className={cls} key={ev.id}>
                  <div className="dot">
                    {ev.kind === "delay" ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : ev.kind === "action" ? (
                      <AlertCircle className="w-3 h-3" />
                    ) : ev.stage === "Delivered" ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Truck className="w-3 h-3" />
                    )}
                  </div>
                  <div className="evc">
                    <div className="evt">
                      <b>{ev.label}</b>
                      <time>{formatDateTime(ev.ts)}</time>
                    </div>
                    <small>{[ev.stage, ev.loc].filter(Boolean).join(" · ")}</small>
                    {ev.note && <small className="nt">{ev.note}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="trk">
      <section className="thero">
        <div className="glow gl1" />
        <div className="wrap">
          <div className="eyebrow c">Live tracking system</div>
          <h1>
            <span className="l">TRACK YOUR</span>
            <span className="l g">SHIPMENT</span>
          </h1>
          <p
            className="lead"
            style={{ maxWidth: 480, margin: "0 auto 30px" }}
          >
            Enter your ShipWell tracking number for live scans, location and
            delivery estimate.
          </p>

          <form
            className="tbar"
            onSubmit={handleSearch}
            noValidate
            autoComplete="off"
          >
            <span className="pin">
              <Search className="w-[18px] h-[18px]" />
            </span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={inputCode}
              onChange={(e) => setInputCode(formatTrackingCode(e.target.value))}
              placeholder="SW-20260531-A8F4B2C1"
              aria-label="Tracking number"
            />
            <button type="submit">TRACK</button>
          </form>

          <div className="thint">
            Always <b>UPPERCASE</b> — we convert it for you ·
            SW-YYYYMMDD-XXXXXXXX
          </div>

          {recentCodes.length > 0 && (
            <div className="chips">
              <small>Recent searches</small>
              {recentCodes.map((c) => (
                <Link key={c} to={`/track/${c}`} className="chipb">
                  {c}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="wrap">
        <div className="tout">{renderViewerOutput()}</div>
      </div>
    </div>
  );
}
