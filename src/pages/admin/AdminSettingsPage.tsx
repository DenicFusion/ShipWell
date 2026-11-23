import React, { useCallback, useEffect, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Sliders,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth, db } from "@/lib/firebase";
import { AdminShell } from "@/components/admin/AdminShell";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { formatDateTime } from "@/lib/quote-engine";
import {
  firestoreTimeToMs,
  type AdminPaymentSettingsPublic,
  type ErrorLogRecord,
  type GatewayId,
  type SecretMask,
  type WebhookEventLog,
} from "@/types/tracking";

type SettingsTab = "bachs" | "methods" | "resend" | "gateways" | "routing" | "activity";

const BACHS_EVENTS = [
  "collection.succeeded",
  "collection.failed",
  "collection.abandoned",
  "collection.underpaid",
  "checkout.expired",
  "refund.created",
  "refund.paid",
  "refund.failed",
];

interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  code?: string;
  detail: string;
  createdAtMs: number;
}

function SecretInputField({
  id,
  label,
  hint,
  mask,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  hint?: string;
  mask?: SecretMask;
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  const [replacing, setReplacing] = useState(false);
  const showInput = !mask?.configured || replacing;

  return (
    <div className="fw">
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      <div className="cfg-sec">
        {mask?.configured && !replacing && (
          <div className="cfg-url" style={{ marginBottom: 4 }}>
            <div>
              <div className="cfg-mask mono">
                {mask.masked || `••••••••${mask.last4 || ""}`}
              </div>
              {mask.updatedAt ? (
                <small className="cfg-h" style={{ marginTop: 2 }}>
                  Saved {formatDateTime(mask.updatedAt)}
                  {mask.updatedBy ? ` by ${mask.updatedBy}` : ""}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="sw-btn sw-btn-ghost"
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => setReplacing(true)}
            >
              Replace
            </button>
          </div>
        )}
        {showInput && (
          <div className="flex gap-2">
            <input
              id={id}
              type="password"
              className="field mono flex-1"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              autoComplete="new-password"
            />
            {replacing && (
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                onClick={() => {
                  onChange("");
                  setReplacing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
      {hint && <small className="cfg-h">{hint}</small>}
    </div>
  );
}

export default function AdminSettingsPage() {
  const { user, isAdmin } = useShipWell();
  const [tab, setTab] = useState<SettingsTab>("bachs");
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState("");
  const [settings, setSettings] = useState<AdminPaymentSettingsPublic | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable non-secret fields
  const [envMode, setEnvMode] = useState<"sandbox" | "live">("sandbox");
  const [sandboxProductId, setSandboxProductId] = useState("");
  const [liveProductId, setLiveProductId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [expiryMins, setExpiryMins] = useState("60");

  // Editable write-only secret inputs
  const [sandboxKeyInput, setSandboxKeyInput] = useState("");
  const [liveKeyInput, setLiveKeyInput] = useState("");
  const [sandboxWebhookInput, setSandboxWebhookInput] = useState("");
  const [liveWebhookInput, setLiveWebhookInput] = useState("");
  const [prevWebhookInput, setPrevWebhookInput] = useState("");

  // Resend fields
  const [resendFrom, setResendFrom] = useState(
    "ShipWell <notifications@mail.shipwell.cc>"
  );
  const [resendReplyTo, setResendReplyTo] = useState("support@mail.shipwell.cc");
  const [resendInbox, setResendInbox] = useState("support@mail.shipwell.cc");
  const [fromSecurity, setFromSecurity] = useState("ShipWell Security <noreply@mail.shipwell.cc>");
  const [fromTracking, setFromTracking] = useState("ShipWell Tracking <tracking@mail.shipwell.cc>");
  const [fromBilling, setFromBilling] = useState("ShipWell Billing <billing@mail.shipwell.cc>");
  const [fromPayments, setFromPayments] = useState("ShipWell Payments <payments@mail.shipwell.cc>");
  const [fromNotifications, setFromNotifications] = useState("ShipWell <notifications@mail.shipwell.cc>");
  const [fromSupport, setFromSupport] = useState("ShipWell Support <support@mail.shipwell.cc>");
  const [resendKeyInput, setResendKeyInput] = useState("");
  const [resendInboundInput, setResendInboundInput] = useState("");
  const [testEmailTarget, setTestEmailTarget] = useState(() => user?.email || "");

  // Other gateways
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripePublic, setStripePublic] = useState("");
  const [stripeSecretInput, setStripeSecretInput] = useState("");
  const [stripeWebhookInput, setStripeWebhookInput] = useState("");

  const [paystackEnabled, setPaystackEnabled] = useState(false);
  const [paystackPublic, setPaystackPublic] = useState("");
  const [paystackSecretInput, setPaystackSecretInput] = useState("");
  const [paystackWebhookInput, setPaystackWebhookInput] = useState("");

  // Routing
  const [primaryGateway, setPrimaryGateway] = useState<GatewayId>("bachs");
  const [fallbackOrder, setFallbackOrder] = useState("bachs");
  const [offerChoice, setOfferChoice] = useState(false);
  const [enableBachsBooking, setEnableBachsBooking] = useState(true);
  const [enablePayOnPickup, setEnablePayOnPickup] = useState(true);

  // Live activity & test checkout results
  const [webhookLogs, setWebhookLogs] = useState<WebhookEventLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRecord[]>([]);
  const [testCheckoutUrl, setTestCheckoutUrl] = useState("");
  const [testResult, setTestResult] = useState<string>("");
  const [busyTool, setBusyTool] = useState("");

  // Modals (Live switch confirmation + Password re-authentication)
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
  const [reauthModal, setReauthModal] = useState<{
    pendingPayload: Record<string, unknown>;
  } | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");

  const hydrateFromSettings = useCallback((s: AdminPaymentSettingsPublic) => {
    setSettings(s);
    setEnvMode(s.bachs.environment);
    setSandboxProductId(s.bachs.sandboxProductId || "");
    setLiveProductId(s.bachs.liveProductId || "");
    setOrgId(s.bachs.organizationId || "");
    setDefaultCurrency(s.bachs.defaultCurrency || "USD");
    setExpiryMins(String(s.bachs.checkoutExpiryMinutes || 60));

    setResendFrom(s.resend.from || "ShipWell <notifications@mail.shipwell.cc>");
    setResendReplyTo(s.resend.replyTo || "support@mail.shipwell.cc");
    setResendInbox(s.resend.supportInbox || "support@mail.shipwell.cc");
    setFromSecurity(s.resend.fromSecurity || "ShipWell Security <noreply@mail.shipwell.cc>");
    setFromTracking(s.resend.fromTracking || "ShipWell Tracking <tracking@mail.shipwell.cc>");
    setFromBilling(s.resend.fromBilling || "ShipWell Billing <billing@mail.shipwell.cc>");
    setFromPayments(s.resend.fromPayments || "ShipWell Payments <payments@mail.shipwell.cc>");
    setFromNotifications(
      s.resend.fromNotifications || s.resend.from || "ShipWell <notifications@mail.shipwell.cc>"
    );
    setFromSupport(s.resend.fromSupport || "ShipWell Support <support@mail.shipwell.cc>");

    setStripeEnabled(Boolean(s.stripe.enabled));
    setStripePublic(s.stripe.publicKey || "");
    setPaystackEnabled(Boolean(s.paystack.enabled));
    setPaystackPublic(s.paystack.publicKey || "");

    setPrimaryGateway(s.routing.primaryGateway || "bachs");
    setFallbackOrder((s.routing.fallbackOrder || ["bachs"]).join(", "));
    setOfferChoice(Boolean(s.routing.offerChoice));
    setEnableBachsBooking(s.routing.enableBachsBooking !== false);
    setEnablePayOnPickup(s.routing.enablePayOnPickup !== false);
  }, []);

  const fetchSettings = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    setServerError("");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to load admin settings.");
      }
      if (data.settings) {
        hydrateFromSettings(data.settings);
      }
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Could not load settings."
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFromSettings]);

  useEffect(() => {
    if (!isAdmin || !auth.currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token || cancelled) return;
        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data.error || "Unable to load admin settings.");
        }
        if (data.settings) {
          hydrateFromSettings(data.settings);
        }
        setServerError("");
      } catch (err) {
        if (!cancelled) {
          setServerError(
            err instanceof Error ? err.message : "Could not load settings."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, hydrateFromSettings]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsubWh = onSnapshot(
      query(collection(db, "webhookLogs"), orderBy("ts", "desc"), limit(40)),
      (snap) => {
        setWebhookLogs(
          snap.docs.map((d) => ({
            ...(d.data() as Omit<WebhookEventLog, "id">),
            id: d.id,
          }))
        );
      },
      () => undefined
    );

    const unsubAu = onSnapshot(
      query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(40)),
      (snap) => {
        setAuditLogs(
          snap.docs.map((d) => ({
            id: d.id,
            actorEmail: String(d.data().actorEmail || ""),
            action: String(d.data().action || ""),
            code: d.data().code ? String(d.data().code) : undefined,
            detail: String(d.data().detail || ""),
            createdAtMs: firestoreTimeToMs(d.data().createdAt),
          }))
        );
      },
      () => undefined
    );

    const unsubErr = onSnapshot(
      query(collection(db, "errorLogs"), orderBy("ts", "desc"), limit(40)),
      (snap) => {
        setErrorLogs(
          snap.docs.map((d) => ({
            ...(d.data() as Omit<ErrorLogRecord, "id">),
            id: d.id,
          }))
        );
      },
      () => undefined
    );

    return () => {
      unsubWh();
      unsubAu();
      unsubErr();
    };
  }, [isAdmin]);

  const webhookEndpoint =
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
      ? `${window.location.origin}/api/bachs-webhook`
      : "https://shipwell.cc/api/bachs-webhook";

  const submitSettingsPatch = async (patch: Record<string, unknown>) => {
    if (!auth.currentUser) return;
    setSaving(true);
    try {
      const token = await auth.currentUser.getIdToken(true);
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "RECENT_AUTH_REQUIRED") {
          setReauthPassword("");
          setReauthModal({ pendingPayload: patch });
          return;
        }
        throw new Error(data.error || "Failed to save settings.");
      }
      if (data.settings) {
        hydrateFromSettings(data.settings);
      }
      setSandboxKeyInput("");
      setLiveKeyInput("");
      setSandboxWebhookInput("");
      setLiveWebhookInput("");
      setPrevWebhookInput("");
      setResendKeyInput("");
      setResendInboundInput("");
      setStripeSecretInput("");
      setStripeWebhookInput("");
      setPaystackSecretInput("");
      setPaystackWebhookInput("");
      toast.success("Encrypted settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBachs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      sandboxKeyInput.trim() &&
      !sandboxKeyInput.trim().startsWith("sk_sandbox_")
    ) {
      toast.error("Sandbox secret key must start with sk_sandbox_");
      return;
    }
    if (liveKeyInput.trim() && !liveKeyInput.trim().startsWith("sk_live_")) {
      toast.error("Live secret key must start with sk_live_");
      return;
    }

    const hasLiveKey =
      Boolean(settings?.bachs.secrets.liveSecretKey.configured) ||
      Boolean(liveKeyInput.trim());
    const hasLiveWh =
      Boolean(settings?.bachs.secrets.liveWebhookSecret.configured) ||
      Boolean(liveWebhookInput.trim());

    if (envMode === "live" && (!hasLiveKey || !hasLiveWh)) {
      toast.error(
        "Save both your Live Secret Key and Live Webhook Secret before enabling Live mode."
      );
      return;
    }

    const payload = {
      bachs: {
        environment: envMode,
        sandboxProductId: sandboxProductId.trim(),
        liveProductId: liveProductId.trim(),
        organizationId: orgId.trim(),
        defaultCurrency: defaultCurrency.trim().toUpperCase() || "USD",
        checkoutExpiryMinutes: Math.max(5, Math.min(1440, Number(expiryMins) || 60)),
        ...(sandboxKeyInput.trim() ? { sandboxSecretKey: sandboxKeyInput.trim() } : {}),
        ...(liveKeyInput.trim() ? { liveSecretKey: liveKeyInput.trim() } : {}),
        ...(sandboxWebhookInput.trim()
          ? { sandboxWebhookSecret: sandboxWebhookInput.trim() }
          : {}),
        ...(liveWebhookInput.trim()
          ? { liveWebhookSecret: liveWebhookInput.trim() }
          : {}),
        ...(prevWebhookInput.trim()
          ? { previousWebhookSecret: prevWebhookInput.trim() }
          : {}),
      },
    };

    if (
      envMode === "live" &&
      settings?.bachs.environment !== "live"
    ) {
      setConfirmLiveOpen(true);
      return;
    }

    await submitSettingsPatch(payload);
  };

  const handleTestBachs = async () => {
    if (!auth.currentUser) return;
    setBusyTool("test-bachs");
    setTestResult("");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin/settings/test-bachs", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection test failed.");
      const msg = data.message || `Connected (${data.environment || envMode})`;
      setTestResult(msg);
      toast.success(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test failed.";
      setTestResult(msg);
      toast.error(msg);
    } finally {
      setBusyTool("");
    }
  };

  const handleCreateTestCheckout = async () => {
    if (!auth.currentUser) return;
    setBusyTool("test-checkout");
    setTestCheckoutUrl("");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin/settings/create-test-checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Could not create test checkout.");
      }
      setTestCheckoutUrl(data.checkoutUrl);
      toast.success("Created $1.00 sandbox checkout session");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create test checkout."
      );
    } finally {
      setBusyTool("");
    }
  };

  const handleSendTestEmail = async () => {
    if (!auth.currentUser) return;
    setBusyTool("test-email");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin/settings/test-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to: testEmailTarget || user?.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test email failed.");
      toast.success(
        data.status === "sent"
          ? `Test email sent to ${testEmailTarget || user?.email}`
          : "Email logged (check Resend key for live dispatch)"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test email failed.");
    } finally {
      setBusyTool("");
    }
  };

  const bachsStatusBadge = settings?.bachs.secrets.sandboxSecretKey.configured ||
    settings?.bachs.secrets.liveSecretKey.configured
      ? envMode === "live"
        ? { cls: "g", label: "Live" }
        : { cls: "a", label: "Sandbox" }
      : { cls: "n", label: "Not configured" };

  return (
    <AdminShell title="Settings & Integrations">
      {serverError && (
        <div className="ad-cur a" style={{ marginBottom: 16 }}>
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <b>Server Admin SDK required for encrypted settings</b>
            <div style={{ fontSize: 12.5 }}>{serverError}</div>
          </div>
        </div>
      )}

      {!loading && settings && !settings.encryptionReady && (
        <div className="ad-cur a" style={{ marginBottom: 16 }}>
          <KeyRound className="w-5 h-5 shrink-0" />
          <div>
            <b>SETTINGS_ENCRYPTION_KEY missing</b>
            <div style={{ fontSize: 12.5 }}>
              Set <code>SETTINGS_ENCRYPTION_KEY</code> (32-byte hex or base64)
              in Cloud Functions Secret Manager so saved payment and Resend keys
              encrypt with AES-256-GCM.
            </div>
          </div>
        </div>
      )}

      <div className="cfg-note">
        <ShieldCheck className="w-5 h-5 text-[var(--em)] shrink-0 mt-0.5" />
        <div>
          <b>Write-only AES-256-GCM encryption.</b> Every secret you enter here
          is encrypted on the server before storing in{" "}
          <code>adminSecrets/payments</code>. No secret is ever returned to any
          browser or stored in client code.
        </div>
      </div>

      <div className="cfg-tabs" role="tablist">
        {(
          [
            ["bachs", "Bachs payments"],
            ["methods", "Payment methods"],
            ["resend", "Email (Resend)"],
            ["gateways", "Other gateways"],
            ["routing", "Routing"],
            ["activity", "Activity & theme"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "on" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="dx-skel" style={{ height: 300 }} />
      ) : tab === "methods" ? (
        <PaymentMethodsManager />
      ) : tab === "bachs" ? (
        <div className="ad-split">
          <div>
            <div className="ad-card">
              <div className="ad-ch">
                <div>
                  <b>Bachs API &amp; Secrets</b>
                  <span className={`mini ${bachsStatusBadge.cls}`}>
                    {bachsStatusBadge.label}
                  </span>
                </div>
                <small>
                  {settings?.bachs.lastWebhookAt
                    ? `Webhook ${formatDateTime(settings.bachs.lastWebhookAt)}`
                    : "No webhooks yet"}
                </small>
              </div>
              <form className="ad-cb ad-form" onSubmit={handleSaveBachs}>
                <div className="fw">
                  <label className="lbl">Active environment</label>
                  <div className="seg">
                    <button
                      type="button"
                      className={envMode === "sandbox" ? "on" : ""}
                      onClick={() => setEnvMode("sandbox")}
                    >
                      Sandbox
                    </button>
                    <button
                      type="button"
                      className={envMode === "live" ? "on" : ""}
                      onClick={() => setEnvMode("live")}
                    >
                      Live
                    </button>
                    <button
                      type="button"
                      className="on"
                      style={{ opacity: 0.65, cursor: "default" }}
                      disabled
                    >
                      {envMode === "live" ? "api.bachs.io" : "sandbox-api"}
                    </button>
                  </div>
                </div>

                <SecretInputField
                  id="bachs-sb-key"
                  label="Sandbox secret key"
                  placeholder="sk_sandbox_..."
                  hint="Prefix must be sk_sandbox_"
                  mask={settings?.bachs.secrets.sandboxSecretKey}
                  value={sandboxKeyInput}
                  onChange={setSandboxKeyInput}
                />

                <SecretInputField
                  id="bachs-sb-wh"
                  label="Sandbox webhook signing secret"
                  placeholder="whsec_..."
                  mask={settings?.bachs.secrets.sandboxWebhookSecret}
                  value={sandboxWebhookInput}
                  onChange={setSandboxWebhookInput}
                />

                <SecretInputField
                  id="bachs-lv-key"
                  label="Live secret key"
                  placeholder="sk_live_..."
                  hint="Prefix must be sk_live_ · requires recent password sign-in"
                  mask={settings?.bachs.secrets.liveSecretKey}
                  value={liveKeyInput}
                  onChange={setLiveKeyInput}
                />

                <SecretInputField
                  id="bachs-lv-wh"
                  label="Live webhook signing secret"
                  placeholder="whsec_..."
                  mask={settings?.bachs.secrets.liveWebhookSecret}
                  value={liveWebhookInput}
                  onChange={setLiveWebhookInput}
                />

                <SecretInputField
                  id="bachs-prev-wh"
                  label="Previous webhook secret (optional rotation)"
                  placeholder="Previous signing secret during key rotation"
                  mask={settings?.bachs.secrets.previousWebhookSecret}
                  value={prevWebhookInput}
                  onChange={setPrevWebhookInput}
                />

                <div className="g2">
                  <div className="fw">
                    <label className="lbl" htmlFor="b-sb-prod">
                      Sandbox Product ID
                    </label>
                    <input
                      id="b-sb-prod"
                      className="field mono"
                      value={sandboxProductId}
                      onChange={(e) => setSandboxProductId(e.target.value)}
                      placeholder="prod_..."
                    />
                    <small className="cfg-h">
                      Pay-What-You-Want (custom amount) product in Bachs Sandbox
                    </small>
                  </div>
                  <div className="fw">
                    <label className="lbl" htmlFor="b-lv-prod">
                      Live Product ID
                    </label>
                    <input
                      id="b-lv-prod"
                      className="field mono"
                      value={liveProductId}
                      onChange={(e) => setLiveProductId(e.target.value)}
                      placeholder="prod_..."
                    />
                    <small className="cfg-h">
                      Pay-What-You-Want (custom amount) product in Bachs Live
                    </small>
                  </div>
                </div>

                <div className="g3">
                  <div className="fw">
                    <label className="lbl" htmlFor="b-org">
                      Organization ID (optional)
                    </label>
                    <input
                      id="b-org"
                      className="field mono"
                      value={orgId}
                      onChange={(e) => setOrgId(e.target.value)}
                      placeholder="org_..."
                    />
                  </div>
                  <div className="fw">
                    <label className="lbl" htmlFor="b-cur">
                      Default currency
                    </label>
                    <input
                      id="b-cur"
                      className="field mono"
                      value={defaultCurrency}
                      onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
                      placeholder="USD"
                    />
                  </div>
                  <div className="fw">
                    <label className="lbl" htmlFor="b-exp">
                      Expiry (mins)
                    </label>
                    <input
                      id="b-exp"
                      type="number"
                      className="field mono"
                      min="5"
                      max="1440"
                      value={expiryMins}
                      onChange={(e) => setExpiryMins(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="sw-btn sw-btn-em"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Save Bachs settings
                  </button>
                  <button
                    type="button"
                    disabled={busyTool !== ""}
                    className="sw-btn sw-btn-ghost"
                    onClick={handleTestBachs}
                  >
                    {busyTool === "test-bachs" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : null}
                    Test connection
                  </button>
                  <button
                    type="button"
                    disabled={busyTool !== ""}
                    className="sw-btn sw-btn-ghost"
                    onClick={handleCreateTestCheckout}
                  >
                    {busyTool === "test-checkout" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : null}
                    Create $1 test checkout
                  </button>
                </div>

                {testResult && (
                  <div className="cfg-note" style={{ marginBottom: 0 }}>
                    <span>{testResult}</span>
                  </div>
                )}

                {testCheckoutUrl && (
                  <div className="cfg-url" style={{ marginTop: 6 }}>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {testCheckoutUrl}
                    </span>
                    <a
                      href={testCheckoutUrl}
                      className="sw-btn sw-btn-em"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                    >
                      Open checkout <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </form>
            </div>
          </div>

          <div>
            <div className="ad-card">
              <div className="ad-ch">
                <b>Bachs Webhook Setup</b>
                <small>HMAC X-Bachs-Timestamp + Signature</small>
              </div>
              <div className="ad-cb">
                <label className="lbl">Webhook destination URL</label>
                <div className="cfg-url">
                  <span className="mono">{webhookEndpoint}</span>
                  <button
                    type="button"
                    className="sw-btn sw-btn-ghost"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                    onClick={() => {
                      navigator.clipboard.writeText(webhookEndpoint);
                      toast.success("Webhook URL copied");
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>

                <label className="lbl">Subscribe to these events</label>
                <div className="cfg-ev">
                  {BACHS_EVENTS.map((ev) => (
                    <span key={ev} className="mono">
                      {ev}
                    </span>
                  ))}
                </div>

                <ol className="cfg-steps">
                  <li>
                    Sign in to <b>app.bachs.io</b> → Developer Portal →{" "}
                    <b>API Keys</b>, create a secret key (shown only once), and
                    paste it here.
                  </li>
                  <li>
                    Open Developer Portal → <b>Webhooks</b>, add{" "}
                    <code>{webhookEndpoint}</code> (use separate destinations
                    for Sandbox and Live).
                  </li>
                  <li>
                    Select all 8 events above, copy the signing secret, and save
                    it in the Webhook signing secret field.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      ) : tab === "resend" ? (
        <div className="ad-card">
          <div className="ad-ch">
            <b>Domain: mail.shipwell.cc (sending and receiving)</b>
            <small>Resend Outbound &amp; Inbound Email</small>
          </div>
          <form
            className="ad-cb ad-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await submitSettingsPatch({
                resend: {
                  from: resendFrom.trim(),
                  replyTo: resendReplyTo.trim(),
                  supportInbox: resendInbox.trim(),
                  fromSecurity: fromSecurity.trim(),
                  fromTracking: fromTracking.trim(),
                  fromBilling: fromBilling.trim(),
                  fromPayments: fromPayments.trim(),
                  fromNotifications: fromNotifications.trim(),
                  fromSupport: fromSupport.trim(),
                  ...(resendKeyInput.trim()
                    ? { apiKey: resendKeyInput.trim() }
                    : {}),
                  ...(resendInboundInput.trim()
                    ? { inboundWebhookSecret: resendInboundInput.trim() }
                    : {}),
                },
              });
            }}
          >
            <div className="g2">
              <div className="fw">
                <label className="lbl" htmlFor="res-from">
                  Default From address
                </label>
                <input
                  id="res-from"
                  className="field"
                  value={resendFrom}
                  onChange={(e) => setResendFrom(e.target.value)}
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="res-rt">
                  Reply-To &amp; support inbox
                </label>
                <input
                  id="res-rt"
                  className="field"
                  value={resendReplyTo}
                  onChange={(e) => {
                    setResendReplyTo(e.target.value);
                    setResendInbox(e.target.value);
                  }}
                />
              </div>
            </div>

            <div className="g2">
              <div className="fw">
                <label className="lbl" htmlFor="res-f-sec">
                  Security / Auth sender (no-reply)
                </label>
                <input
                  id="res-f-sec"
                  className="field"
                  value={fromSecurity}
                  onChange={(e) => setFromSecurity(e.target.value)}
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="res-f-trk">
                  Tracking &amp; invite sender
                </label>
                <input
                  id="res-f-trk"
                  className="field"
                  value={fromTracking}
                  onChange={(e) => setFromTracking(e.target.value)}
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="res-f-bil">
                  Billing &amp; receipt sender
                </label>
                <input
                  id="res-f-bil"
                  className="field"
                  value={fromBilling}
                  onChange={(e) => setFromBilling(e.target.value)}
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="res-f-pay">
                  Payments &amp; verification sender
                </label>
                <input
                  id="res-f-pay"
                  className="field"
                  value={fromPayments}
                  onChange={(e) => setFromPayments(e.target.value)}
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="res-f-not">
                  Alerts &amp; operations sender
                </label>
                <input
                  id="res-f-not"
                  className="field"
                  value={fromNotifications}
                  onChange={(e) => setFromNotifications(e.target.value)}
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="res-f-sup">
                  Support desk sender
                </label>
                <input
                  id="res-f-sup"
                  className="field"
                  value={fromSupport}
                  onChange={(e) => setFromSupport(e.target.value)}
                />
              </div>
            </div>

            <SecretInputField
              id="res-api"
              label="Resend API key"
              placeholder="re_..."
              hint="Domain mail.shipwell.cc verified in Resend for sending and receiving"
              mask={settings?.resend.secrets.apiKey}
              value={resendKeyInput}
              onChange={setResendKeyInput}
            />

            <SecretInputField
              id="res-inb"
              label="Resend Inbound webhook signing secret (whsec_...)"
              placeholder="whsec_..."
              hint="Point Resend Inbound webhook to your Cloud Function inboundEmail URL (or /api/inbound-email)"
              mask={settings?.resend.secrets.inboundWebhookSecret}
              value={resendInboundInput}
              onChange={setResendInboundInput}
            />

            <div className="flex flex-wrap gap-3 items-end">
              <button
                type="submit"
                disabled={saving}
                className="sw-btn sw-btn-em"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save Resend settings
              </button>

              <div className="flex gap-2 items-center flex-wrap">
                <input
                  type="email"
                  className="field"
                  style={{ width: 220, padding: "10px 12px" }}
                  value={testEmailTarget}
                  onChange={(e) => setTestEmailTarget(e.target.value)}
                  placeholder="test@email.com"
                />
                <button
                  type="button"
                  disabled={busyTool === "test-email"}
                  className="sw-btn sw-btn-ghost"
                  onClick={handleSendTestEmail}
                >
                  {busyTool === "test-email" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send test email
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : tab === "gateways" ? (
        <div className="ad-split">
          <div className="ad-card">
            <div className="ad-ch">
              <b>Stripe (Optional Fallback)</b>
              <small>{stripeEnabled ? "Enabled" : "Disabled"}</small>
            </div>
            <form
              className="ad-cb ad-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await submitSettingsPatch({
                  stripe: {
                    enabled: stripeEnabled,
                    publicKey: stripePublic.trim(),
                    ...(stripeSecretInput.trim()
                      ? { secretKey: stripeSecretInput.trim() }
                      : {}),
                    ...(stripeWebhookInput.trim()
                      ? { webhookSecret: stripeWebhookInput.trim() }
                      : {}),
                  },
                });
              }}
            >
              <label className="chk">
                <input
                  type="checkbox"
                  checked={stripeEnabled}
                  onChange={(e) => setStripeEnabled(e.target.checked)}
                />
                <span>Enable Stripe as optional customs gateway</span>
              </label>
              <div className="fw">
                <label className="lbl" htmlFor="st-pk">
                  Publishable key
                </label>
                <input
                  id="st-pk"
                  className="field mono"
                  value={stripePublic}
                  onChange={(e) => setStripePublic(e.target.value)}
                  placeholder="pk_test_... / pk_live_..."
                />
              </div>
              <SecretInputField
                id="st-sk"
                label="Stripe secret key"
                placeholder="sk_test_... / sk_live_..."
                mask={settings?.stripe.secrets.secretKey}
                value={stripeSecretInput}
                onChange={setStripeSecretInput}
              />
              <SecretInputField
                id="st-wh"
                label="Stripe webhook secret"
                placeholder="whsec_..."
                mask={settings?.stripe.secrets.webhookSecret}
                value={stripeWebhookInput}
                onChange={setStripeWebhookInput}
              />
              <button
                type="submit"
                disabled={saving}
                className="sw-btn sw-btn-em"
              >
                Save Stripe settings
              </button>
            </form>
          </div>

          <div className="ad-card">
            <div className="ad-ch">
              <b>Paystack (Optional Fallback)</b>
              <small>{paystackEnabled ? "Enabled" : "Disabled"}</small>
            </div>
            <form
              className="ad-cb ad-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await submitSettingsPatch({
                  paystack: {
                    enabled: paystackEnabled,
                    publicKey: paystackPublic.trim(),
                    ...(paystackSecretInput.trim()
                      ? { secretKey: paystackSecretInput.trim() }
                      : {}),
                    ...(paystackWebhookInput.trim()
                      ? { webhookSecret: paystackWebhookInput.trim() }
                      : {}),
                  },
                });
              }}
            >
              <label className="chk">
                <input
                  type="checkbox"
                  checked={paystackEnabled}
                  onChange={(e) => setPaystackEnabled(e.target.checked)}
                />
                <span>Enable Paystack as optional customs gateway</span>
              </label>
              <div className="fw">
                <label className="lbl" htmlFor="ps-pk">
                  Public key
                </label>
                <input
                  id="ps-pk"
                  className="field mono"
                  value={paystackPublic}
                  onChange={(e) => setPaystackPublic(e.target.value)}
                  placeholder="pk_test_... / pk_live_..."
                />
              </div>
              <SecretInputField
                id="ps-sk"
                label="Paystack secret key"
                placeholder="sk_test_... / sk_live_..."
                mask={settings?.paystack.secrets.secretKey}
                value={paystackSecretInput}
                onChange={setPaystackSecretInput}
              />
              <SecretInputField
                id="ps-wh"
                label="Paystack webhook secret"
                placeholder="Webhook secret"
                mask={settings?.paystack.secrets.webhookSecret}
                value={paystackWebhookInput}
                onChange={setPaystackWebhookInput}
              />
              <button
                type="submit"
                disabled={saving}
                className="sw-btn sw-btn-em"
              >
                Save Paystack settings
              </button>
            </form>
          </div>
        </div>
      ) : tab === "routing" ? (
        <div className="ad-card">
          <div className="ad-ch">
            <b>Gateway routing &amp; checkout choice</b>
            <small>Customs duty checkout behavior</small>
          </div>
          <form
            className="ad-cb ad-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const order = fallbackOrder
                .split(",")
                .map((x) => x.trim().toLowerCase())
                .filter(
                  (x): x is GatewayId =>
                    x === "bachs" || x === "stripe" || x === "paystack"
                );
              await submitSettingsPatch({
                routing: {
                  primaryGateway,
                  fallbackOrder: order.length ? order : [primaryGateway],
                  offerChoice,
                  enableBachsBooking,
                  enablePayOnPickup,
                },
              });
            }}
          >
            <div className="g2">
              <div className="fw">
                <label className="lbl" htmlFor="rt-prim">
                  Primary gateway
                </label>
                <select
                  id="rt-prim"
                  className="field"
                  value={primaryGateway}
                  onChange={(e) => setPrimaryGateway(e.target.value as GatewayId)}
                >
                  <option value="bachs">Bachs (Default)</option>
                  <option value="stripe">Stripe</option>
                  <option value="paystack">Paystack</option>
                </select>
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="rt-fb">
                  Fallback order (comma separated)
                </label>
                <input
                  id="rt-fb"
                  className="field mono"
                  value={fallbackOrder}
                  onChange={(e) => setFallbackOrder(e.target.value)}
                  placeholder="bachs, stripe, paystack"
                />
              </div>
            </div>

            <label className="chk">
              <input
                type="checkbox"
                checked={offerChoice}
                onChange={(e) => setOfferChoice(e.target.checked)}
              />
              <span>
                Let receivers choose between enabled payment gateways on Duties
                &amp; charges
              </span>
            </label>

            <label className="chk">
              <input
                type="checkbox"
                checked={enableBachsBooking}
                onChange={(e) => setEnableBachsBooking(e.target.checked)}
              />
              <span>
                Allow Pay now (Bachs Checkout) on Ship booking checkout
              </span>
            </label>

            <label className="chk">
              <input
                type="checkbox"
                checked={enablePayOnPickup}
                onChange={(e) => setEnablePayOnPickup(e.target.checked)}
              />
              <span>
                Allow Pay on delivery during Ship booking checkout
              </span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="sw-btn sw-btn-em"
            >
              <Sliders className="w-4 h-4" />
              Save routing rules
            </button>
          </form>
        </div>
      ) : (
        <div className="ad-split">
          <div>
            <div className="ad-card">
              <div className="ad-ch">
                <b>Recent webhook events</b>
                <small>Live from webhookLogs</small>
              </div>
              <div className="cfg-tbl">
                {webhookLogs.length === 0 ? (
                  <div className="sp-none">No webhooks recorded yet.</div>
                ) : (
                  webhookLogs.map((w) => (
                    <div className="cfg-r" key={w.id}>
                      <span
                        className={`chip ${
                          w.result === "processed"
                            ? "g"
                            : w.result === "duplicate"
                              ? "b"
                              : w.result === "rejected-signature"
                                ? "r"
                                : "n"
                        }`}
                      >
                        {w.result}
                      </span>
                      <b className="mono">{w.eventType}</b>
                      <span className="cfg-ref mono">{w.reference}</span>
                      <time>{formatDateTime(w.ts)}</time>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ad-card">
              <div className="ad-ch">
                <b>Theme preference</b>
                <small>Applies to your account across devices</small>
              </div>
              <div className="ad-cb">
                <ThemeSwitch />
              </div>
            </div>
          </div>

          <div>
            <div className="ad-card">
              <div className="ad-ch">
                <b>Admin audit trail</b>
                <small>Config changes &amp; operations</small>
              </div>
              <div className="cfg-tbl">
                {auditLogs.length === 0 ? (
                  <div className="sp-none">No audit events recorded yet.</div>
                ) : (
                  auditLogs.map((a) => (
                    <div className="cfg-r" key={a.id}>
                      <span className="chip b">{a.action}</span>
                      <span>{a.detail}</span>
                      <span className="cfg-ref">{a.actorEmail}</span>
                      <time>{formatDateTime(a.createdAtMs)}</time>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ad-card">
              <div className="ad-ch">
                <b>Error &amp; diagnostic logs</b>
                <small>Client &amp; server step/code failures</small>
              </div>
              <div className="cfg-tbl">
                {errorLogs.length === 0 ? (
                  <div className="sp-none">No error logs recorded.</div>
                ) : (
                  errorLogs.map((er) => (
                    <div className="cfg-r" key={er.id}>
                      <span className="chip r">{er.code}</span>
                      <b className="mono">{er.step}</b>
                      <span>{er.message}</span>
                      <time>{formatDateTime(er.ts)}</time>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIVE MODE CONFIRMATION MODAL (ZERO window.confirm) */}
      {confirmLiveOpen && (
        <div className="md" role="dialog" aria-modal="true">
          <div className="md-b" onClick={() => setConfirmLiveOpen(false)} />
          <div className="md-c">
            <button
              className="md-x"
              onClick={() => setConfirmLiveOpen(false)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="au-ic" style={{ color: "var(--amber)" }}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="au-t">SWITCH TO BACHS LIVE?</div>
            <p className="au-r">
              Switching Bachs to <b>Live</b> routes real customs charges through{" "}
              <code>api.bachs.io</code>. Confirm your Live keys and webhook
              destination are ready.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="sw-btn sw-btn-ghost flex-1"
                onClick={() => setConfirmLiveOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sw-btn sw-btn-em flex-1"
                onClick={async () => {
                  setConfirmLiveOpen(false);
                  await submitSettingsPatch({
                    bachs: {
                      environment: "live",
                      sandboxProductId: sandboxProductId.trim(),
                      liveProductId: liveProductId.trim(),
                      organizationId: orgId.trim(),
                      defaultCurrency: defaultCurrency.trim().toUpperCase() || "USD",
                      checkoutExpiryMinutes: Math.max(
                        5,
                        Math.min(1440, Number(expiryMins) || 60)
                      ),
                      ...(liveKeyInput.trim()
                        ? { liveSecretKey: liveKeyInput.trim() }
                        : {}),
                      ...(liveWebhookInput.trim()
                        ? { liveWebhookSecret: liveWebhookInput.trim() }
                        : {}),
                    },
                  });
                }}
              >
                Enable Live mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PASSWORD RE-AUTHENTICATION MODAL */}
      {reauthModal && (
        <div className="md" role="dialog" aria-modal="true">
          <div className="md-b" onClick={() => setReauthModal(null)} />
          <div className="md-c">
            <button
              className="md-x"
              onClick={() => setReauthModal(null)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="au-ic">
              <KeyRound className="w-6 h-6" />
            </div>
            <div className="au-t">CONFIRM YOUR PASSWORD</div>
            <p className="au-r">
              Updating Live payment settings requires a recent admin login.
            </p>
            <form
              className="au-f"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!auth.currentUser || !user?.email) return;
                try {
                  const cred = EmailAuthProvider.credential(
                    user.email,
                    reauthPassword
                  );
                  await reauthenticateWithCredential(auth.currentUser, cred);
                  const pending = reauthModal.pendingPayload;
                  setReauthModal(null);
                  setReauthPassword("");
                  await submitSettingsPatch(pending);
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Password confirmation failed."
                  );
                }
              }}
            >
              <div className="fw">
                <label className="lbl" htmlFor="reauth-pw">
                  Admin password
                </label>
                <input
                  id="reauth-pw"
                  type="password"
                  className="field"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="sw-btn sw-btn-em sw-btn-lg sw-btn-block">
                <Mail className="w-4 h-4" />
                Verify &amp; save settings
              </button>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
