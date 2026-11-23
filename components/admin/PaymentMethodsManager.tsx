import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  CreditCard,
  Edit3,
  Eye,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import {
  calculateMethodAmounts,
  formatMethodInstructions,
} from "@/lib/payment-methods";
import { uploadPaymentMethodAsset } from "@/lib/storage";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
import type {
  GatewayId,
  ManualPaymentRecord,
  PaymentMethodDetailRow,
  PaymentMethodRecord,
  PaymentMethodType,
} from "@/types/tracking";

const BLANK_METHOD: PaymentMethodRecord = {
  id: "",
  name: "",
  subtitle: "",
  type: "bank_transfer",
  gateway: null,
  enabled: true,
  order: 10,
  currency: "USD",
  exchangeRate: 1,
  details: [{ label: "Account name", value: "", copyable: true }],
  instructions:
    "Send {amount} {currency} to the account above and include reference {reference} ({trackingCode}). Upload your payment receipt below.",
  iconUrl: "",
  qrUrl: "",
  fee: { mode: "none", kind: "fee", amount: 0 },
  rules: {
    minAmount: 0,
    maxAmount: 0,
    allowedCountries: [],
    appliesTo: "both",
    audience: "everyone",
  },
  proof: {
    required: true,
    fields: {
      screenshot: true,
      txId: true,
      senderName: true,
      paidAt: false,
    },
    approval: "manual",
  },
  windowMinutes: 1440,
};

export function PaymentMethodsManager() {
  const [methods, setMethods] = useState<PaymentMethodRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<PaymentMethodRecord | null>(null);
  const [countriesText, setCountriesText] = useState("");
  const [previewState, setPreviewState] = useState<{
    method: PaymentMethodRecord;
    openedAt: number;
  } | null>(null);

  const loadMethods = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const data = await apiFetch<{ ok: boolean; methods: PaymentMethodRecord[] }>(
        "/api/admin/payment-methods",
        {
          headers: { Authorization: `Bearer ${token}` },
          step: "admin_list_methods",
        }
      );
      setMethods(data.methods || []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not load payment methods."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) {
        await loadMethods();
      }
    })();
    return () => {
      active = false;
    };
  }, [loadMethods]);

  const startEdit = (m: PaymentMethodRecord) => {
    setEditing({
      ...m,
      details: m.details?.length ? m.details.map((d) => ({ ...d })) : [],
      fee: { ...(m.fee || { mode: "none", kind: "fee", amount: 0 }) },
      rules: {
        minAmount: Number(m.rules?.minAmount || 0),
        maxAmount: Number(m.rules?.maxAmount || 0),
        allowedCountries: [...(m.rules?.allowedCountries || [])],
        appliesTo: m.rules?.appliesTo || "both",
        audience: m.rules?.audience || "everyone",
      },
      proof: {
        required: m.proof?.required ?? m.type !== "cash",
        fields: {
          screenshot: Boolean(m.proof?.fields?.screenshot),
          txId: Boolean(m.proof?.fields?.txId),
          senderName: Boolean(m.proof?.fields?.senderName),
          paidAt: Boolean(m.proof?.fields?.paidAt),
        },
        approval: m.proof?.approval || "manual",
      },
    });
    setCountriesText((m.rules?.allowedCountries || []).join(", "));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !auth.currentUser) return;
    if (!editing.name.trim()) {
      toast.error("Method name is required.");
      return;
    }
    setBusy("save");
    try {
      const token = await auth.currentUser.getIdToken();
      const allowedCountries = countriesText
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const payload: Partial<PaymentMethodRecord> = {
        ...editing,
        gateway: editing.type === "automatic" ? (editing.gateway || "bachs") : null,
        rules: {
          ...editing.rules,
          allowedCountries,
        },
        details: editing.details.filter((d) => d.label.trim() && d.value.trim()),
      };
      const data = await apiFetch<{ ok: boolean; method: PaymentMethodRecord }>(
        "/api/admin/payment-methods",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          step: "admin_save_method",
        }
      );
      toast.success(`Saved "${data.method.name}"`);
      setEditing(null);
      await loadMethods();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save method.");
    } finally {
      setBusy("");
    }
  };

  const handleToggleEnabled = async (m: PaymentMethodRecord) => {
    if (!auth.currentUser) return;
    setBusy(`toggle_${m.id}`);
    try {
      const token = await auth.currentUser.getIdToken();
      await apiFetch<{ ok: boolean; method: PaymentMethodRecord }>(
        "/api/admin/payment-methods",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...m, enabled: !m.enabled }),
          step: "admin_toggle_method",
        }
      );
      toast.success(`${m.name} ${m.enabled ? "disabled" : "enabled"}`);
      await loadMethods();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Toggle failed.");
    } finally {
      setBusy("");
    }
  };

  const handleDuplicate = async (m: PaymentMethodRecord) => {
    if (!auth.currentUser) return;
    setBusy(`dup_${m.id}`);
    try {
      const token = await auth.currentUser.getIdToken();
      await apiFetch<{ ok: boolean; method: PaymentMethodRecord }>(
        "/api/admin/payment-methods/duplicate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: m.id }),
          step: "admin_dup_method",
        }
      );
      toast.success(`Duplicated "${m.name}"`);
      await loadMethods();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Duplicate failed.");
    } finally {
      setBusy("");
    }
  };

  const handleDeleteOrDisable = async (m: PaymentMethodRecord) => {
    if (!auth.currentUser) return;
    setBusy(`del_${m.id}`);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await apiFetch<{ ok: boolean; action: "deleted" | "disabled" }>(
        `/api/admin/payment-methods/${encodeURIComponent(m.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
          step: "admin_delete_method",
        }
      );
      toast.success(
        res.action === "disabled"
          ? `${m.name} disabled (referenced by existing payments)`
          : `${m.name} deleted`
      );
      if (editing?.id === m.id) setEditing(null);
      await loadMethods();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusy("");
    }
  };

  const handleMove = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= methods.length || !auth.currentUser) return;
    const reordered = [...methods];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setMethods(reordered);
    setBusy("reorder");
    try {
      const token = await auth.currentUser.getIdToken();
      const data = await apiFetch<{ ok: boolean; methods: PaymentMethodRecord[] }>(
        "/api/admin/payment-methods/reorder",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ orderedIds: reordered.map((m) => m.id) }),
          step: "admin_reorder_methods",
        }
      );
      setMethods(data.methods || reordered);
      toast.success("Order updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reorder failed.");
      await loadMethods();
    } finally {
      setBusy("");
    }
  };

  const handleUploadAsset = async (kind: "icon" | "qr", file: File | null) => {
    if (!file || !editing) return;
    setBusy(`upload_${kind}`);
    try {
      const targetId = editing.id || `draft_${Date.now()}`;
      const url = await uploadPaymentMethodAsset({
        methodId: targetId,
        kind,
        file,
      });
      setEditing((prev) =>
        prev
          ? {
              ...prev,
              ...(kind === "icon" ? { iconUrl: url } : { qrUrl: url }),
            }
          : null
      );
      toast.success(`${kind === "qr" ? "QR code" : "Icon"} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  };

  const insertToken = (tokenStr: string) => {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            instructions: `${prev.instructions}${prev.instructions.endsWith(" ") || !prev.instructions ? "" : " "}${tokenStr}`,
          }
        : null
    );
  };

  const previewRecord: ManualPaymentRecord | null = useMemo(() => {
    if (!previewState) return null;
    const { method: previewMethod, openedAt } = previewState;
    const sampleRef = "SW-PAY-7X92KP";
    const sampleCode = "SW-20261123-DEMO1234";
    const calc = calculateMethodAmounts(125, previewMethod);
    const decimals = calc.currency === "JPY" ? 0 : 2;
    return {
      id: "preview_payment",
      reference: sampleRef,
      kind: "booking",
      trackingCode: sampleCode,
      uid: "preview_user",
      userEmail: "customer@example.com",
      userName: "Alex Mercer",
      methodId: previewMethod.id || "preview",
      methodName: previewMethod.name || "Custom method",
      methodType: previewMethod.type,
      baseAmount: calc.baseUsd,
      feeAmount: calc.feeAmountUsd,
      totalUsd: calc.totalUsd,
      currency: calc.currency,
      convertedAmount: calc.convertedAmount,
      exchangeRate: calc.exchangeRate,
      detailsSnapshot: previewMethod.details || [],
      instructionsSnapshot: formatMethodInstructions(previewMethod.instructions, {
        amount: calc.convertedAmount.toFixed(decimals),
        currency: calc.currency,
        reference: sampleRef,
        trackingCode: sampleCode,
        name: "Alex Mercer",
      }),
      qrUrlSnapshot: previewMethod.qrUrl,
      proofConfig: previewMethod.proof,
      status: "awaiting_payment",
      expiresAt: openedAt + (previewMethod.windowMinutes || 1440) * 60_000,
      audit: [],
      createdAtMs: openedAt,
      updatedAtMs: openedAt,
    };
  }, [previewState]);

  return (
    <div className="ad-split">
      {/* LEFT: LIST OF PAYMENT METHODS */}
      <div>
        <div className="ad-card">
          <div className="ad-ch">
            <div>
              <b>Configured payment methods</b>
              <small>{methods.length} total</small>
            </div>
            <button
              type="button"
              className="sw-btn sw-btn-em"
              style={{ padding: "7px 12px", fontSize: 12.5 }}
              onClick={() =>
                startEdit({
                  ...BLANK_METHOD,
                  order: methods.length + 1,
                })
              }
            >
              <Plus className="w-4 h-4" />
              Add method
            </button>
          </div>

          {loading ? (
            <div className="ad-cb">
              <div className="dx-skel" style={{ height: 180 }} />
            </div>
          ) : methods.length === 0 ? (
            <div className="ad-ok">No payment methods configured yet.</div>
          ) : (
            <div className="ad-q">
              {methods.map((m, idx) => (
                <div key={m.id} className="ad-qi flex-wrap">
                  <div className={`qd ${m.enabled ? "g" : "n"}`}>
                    {m.iconUrl ? (
                      <img
                        src={m.iconUrl}
                        alt={m.name}
                        className="w-5 h-5 object-contain rounded"
                      />
                    ) : (
                      <CreditCard className="w-4 h-4" />
                    )}
                  </div>
                  <div className="t" style={{ minWidth: 180 }}>
                    <b className="flex items-center gap-2 flex-wrap">
                      <span>{m.name}</span>
                      <span className={`chip ${m.enabled ? "g" : "n"}`}>
                        {m.enabled ? "Active" : "Disabled"}
                      </span>
                    </b>
                    <small>
                      {m.type} · {m.currency} (×{m.exchangeRate}) · applies to{" "}
                      {m.rules?.appliesTo || "both"}
                      {m.fee?.mode && m.fee.mode !== "none"
                        ? ` · ${m.fee.kind} ${m.fee.amount}${m.fee.mode === "percent" ? "%" : " USD"}`
                        : ""}
                    </small>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 8px" }}
                      disabled={idx === 0 || busy !== ""}
                      onClick={() => handleMove(idx, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 8px" }}
                      disabled={idx === methods.length - 1 || busy !== ""}
                      onClick={() => handleMove(idx, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 9px", fontSize: 12 }}
                      onClick={() => setPreviewState({ method: m, openedAt: Date.now() })}
                      aria-label="Preview as customer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 9px", fontSize: 12 }}
                      onClick={() => handleToggleEnabled(m)}
                      disabled={busy !== ""}
                    >
                      {m.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 9px", fontSize: 12 }}
                      onClick={() => startEdit(m)}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 8px" }}
                      onClick={() => handleDuplicate(m)}
                      disabled={busy !== ""}
                      aria-label="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "5px 8px", color: "#fb7185" }}
                      onClick={() => handleDeleteOrDisable(m)}
                      disabled={busy !== ""}
                      aria-label="Delete or disable"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: EDITOR FORM */}
      <div>
        {!editing ? (
          <div className="ad-card ad-ok">
            Select a payment method to edit its instructions, fields, exchange rate, rules, or click <b>Add method</b> to create a new one.
          </div>
        ) : (
          <div className="ad-card">
            <div className="ad-ch">
              <b>{editing.id ? `Edit: ${editing.name}` : "New payment method"}</b>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost"
                  style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={() => setPreviewState({ method: editing, openedAt: Date.now() })}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview as customer
                </button>
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost"
                  style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>
            </div>

            <form className="ad-cb ad-form" onSubmit={handleSave}>
              <div className="g2">
                <div className="fw">
                  <label className="lbl" htmlFor="pm-name">
                    Method name
                  </label>
                  <input
                    id="pm-name"
                    className="field"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="e.g. Wire Transfer (USD)"
                    required
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-sub">
                    Short subtitle
                  </label>
                  <input
                    id="pm-sub"
                    className="field"
                    value={editing.subtitle}
                    onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })}
                    placeholder="Shown on checkout card"
                  />
                </div>
              </div>

              <div className="g3">
                <div className="fw">
                  <label className="lbl" htmlFor="pm-type">
                    Type
                  </label>
                  <select
                    id="pm-type"
                    className="field"
                    value={editing.type}
                    onChange={(e) => {
                      const nextType = e.target.value as PaymentMethodType;
                      setEditing({
                        ...editing,
                        type: nextType,
                        gateway: nextType === "automatic" ? editing.gateway || "bachs" : null,
                        proof: {
                          ...editing.proof,
                          required: nextType !== "cash" && nextType !== "automatic",
                        },
                      });
                    }}
                  >
                    <option value="automatic">Automatic gateway</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="crypto">Crypto wallet</option>
                    <option value="mobile_money">Mobile money</option>
                    <option value="cash">Cash / Pay on delivery</option>
                    <option value="other">Other manual method</option>
                  </select>
                </div>

                {editing.type === "automatic" ? (
                  <div className="fw">
                    <label className="lbl" htmlFor="pm-gw">
                      Gateway
                    </label>
                    <select
                      id="pm-gw"
                      className="field"
                      value={editing.gateway || "bachs"}
                      onChange={(e) =>
                        setEditing({ ...editing, gateway: e.target.value as GatewayId })
                      }
                    >
                      <option value="bachs">Bachs</option>
                      <option value="stripe">Stripe</option>
                      <option value="paystack">Paystack</option>
                    </select>
                  </div>
                ) : (
                  <div className="fw">
                    <label className="lbl" htmlFor="pm-win">
                      Payment window (mins)
                    </label>
                    <input
                      id="pm-win"
                      type="number"
                      min="15"
                      max="10080"
                      className="field mono"
                      value={editing.windowMinutes}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          windowMinutes: Number(e.target.value || 1440),
                        })
                      }
                    />
                  </div>
                )}

                <div className="fw">
                  <label className="lbl" htmlFor="pm-id">
                    Method ID (optional)
                  </label>
                  <input
                    id="pm-id"
                    className="field mono"
                    value={editing.id}
                    onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                    placeholder="auto-generated"
                  />
                </div>
              </div>

              <div className="g2">
                <div className="fw">
                  <label className="lbl" htmlFor="pm-cur">
                    Display currency
                  </label>
                  <input
                    id="pm-cur"
                    className="field mono"
                    value={editing.currency}
                    onChange={(e) =>
                      setEditing({ ...editing, currency: e.target.value.toUpperCase() })
                    }
                    placeholder="USD, EUR, NGN, USDT..."
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-fx">
                    Exchange rate (1 USD =)
                  </label>
                  <input
                    id="pm-fx"
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    className="field mono"
                    value={editing.exchangeRate}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        exchangeRate: Number(e.target.value || 1),
                      })
                    }
                  />
                </div>
              </div>

              {/* FEE OR DISCOUNT */}
              <div className="g3">
                <div className="fw">
                  <label className="lbl" htmlFor="pm-fee-mode">
                    Fee / discount mode
                  </label>
                  <select
                    id="pm-fee-mode"
                    className="field"
                    value={editing.fee.mode}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        fee: {
                          ...editing.fee,
                          mode: e.target.value as "none" | "fixed" | "percent",
                        },
                      })
                    }
                  >
                    <option value="none">No adjustment</option>
                    <option value="percent">Percent (%)</option>
                    <option value="fixed">Fixed USD ($)</option>
                  </select>
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-fee-kind">
                    Type
                  </label>
                  <select
                    id="pm-fee-kind"
                    className="field"
                    value={editing.fee.kind}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        fee: {
                          ...editing.fee,
                          kind: e.target.value as "fee" | "discount",
                        },
                      })
                    }
                  >
                    <option value="fee">Surcharge (+)</option>
                    <option value="discount">Discount (-)</option>
                  </select>
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-fee-amt">
                    Value
                  </label>
                  <input
                    id="pm-fee-amt"
                    type="number"
                    step="0.01"
                    min="0"
                    className="field mono"
                    value={editing.fee.amount}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        fee: { ...editing.fee, amount: Number(e.target.value || 0) },
                      })
                    }
                  />
                </div>
              </div>

              {/* PAYMENT DETAILS KEY-VALUE ROWS */}
              <div className="fw">
                <div className="flex items-center justify-between mb-2">
                  <label className="lbl mb-0">
                    Customer payment details (shown with copy buttons)
                  </label>
                  <button
                    type="button"
                    className="sw-btn sw-btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        details: [
                          ...editing.details,
                          { label: "", value: "", copyable: true },
                        ],
                      })
                    }
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add row
                  </button>
                </div>
                <div className="grid gap-2">
                  {editing.details.map((row: PaymentMethodDetailRow, idx: number) => (
                    <div key={idx} className="grid sm:grid-cols-[1fr_1.4fr_auto_auto] gap-2 items-center">
                      <input
                        className="field"
                        value={row.label}
                        onChange={(e) => {
                          const next = [...editing.details];
                          next[idx] = { ...next[idx], label: e.target.value };
                          setEditing({ ...editing, details: next });
                        }}
                        placeholder="Label (e.g. IBAN)"
                      />
                      <input
                        className="field"
                        value={row.value}
                        onChange={(e) => {
                          const next = [...editing.details];
                          next[idx] = { ...next[idx], value: e.target.value };
                          setEditing({ ...editing, details: next });
                        }}
                        placeholder="Value"
                      />
                      <label className="chk text-xs whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={row.copyable !== false}
                          onChange={(e) => {
                            const next = [...editing.details];
                            next[idx] = { ...next[idx], copyable: e.target.checked };
                            setEditing({ ...editing, details: next });
                          }}
                        />
                        <span>Copy</span>
                      </label>
                      <button
                        type="button"
                        className="sw-btn sw-btn-ghost"
                        style={{ padding: "6px 8px", color: "#fb7185" }}
                        onClick={() => {
                          const next = editing.details.filter((_, i) => i !== idx);
                          setEditing({ ...editing, details: next });
                        }}
                        aria-label="Remove row"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* INSTRUCTIONS */}
              <div className="fw">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                  <label className="lbl mb-0" htmlFor="pm-inst">
                    Payment instructions
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {["{amount}", "{currency}", "{reference}", "{trackingCode}", "{name}"].map(
                      (tok) => (
                        <button
                          key={tok}
                          type="button"
                          className="sw-btn sw-btn-ghost"
                          style={{ padding: "2px 7px", fontSize: 11 }}
                          onClick={() => insertToken(tok)}
                        >
                          {tok}
                        </button>
                      )
                    )}
                  </div>
                </div>
                <textarea
                  id="pm-inst"
                  className="field"
                  rows={3}
                  value={editing.instructions}
                  onChange={(e) =>
                    setEditing({ ...editing, instructions: e.target.value })
                  }
                />
              </div>

              {/* ASSETS (ICON + QR CODE) */}
              <div className="g2">
                <div className="fw">
                  <label className="lbl">Method icon (optional)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      className="field flex-1"
                      value={editing.iconUrl || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, iconUrl: e.target.value })
                      }
                      placeholder="https://..."
                    />
                    <label className="sw-btn sw-btn-ghost cursor-pointer">
                      {busy === "upload_icon" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) =>
                          handleUploadAsset("icon", e.target.files?.[0] || null)
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="fw">
                  <label className="lbl">Payment QR code image (optional)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      className="field flex-1"
                      value={editing.qrUrl || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, qrUrl: e.target.value })
                      }
                      placeholder="https://..."
                    />
                    <label className="sw-btn sw-btn-ghost cursor-pointer">
                      {busy === "upload_qr" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) =>
                          handleUploadAsset("qr", e.target.files?.[0] || null)
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* RULES */}
              <div className="g2">
                <div className="fw">
                  <label className="lbl" htmlFor="pm-applies">
                    Applies to
                  </label>
                  <select
                    id="pm-applies"
                    className="field"
                    value={editing.rules.appliesTo}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        rules: {
                          ...editing.rules,
                          appliesTo: e.target.value as "shipping" | "customs" | "both",
                        },
                      })
                    }
                  >
                    <option value="both">Shipping bookings &amp; Customs fees</option>
                    <option value="shipping">Shipping bookings only</option>
                    <option value="customs">Customs fees only</option>
                  </select>
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-aud">
                    Audience
                  </label>
                  <select
                    id="pm-aud"
                    className="field"
                    value={editing.rules.audience}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        rules: {
                          ...editing.rules,
                          audience: e.target.value as "everyone" | "business",
                        },
                      })
                    }
                  >
                    <option value="everyone">All customers</option>
                    <option value="business">Business accounts only</option>
                  </select>
                </div>
              </div>

              <div className="g3">
                <div className="fw">
                  <label className="lbl" htmlFor="pm-min">
                    Min USD (0 = none)
                  </label>
                  <input
                    id="pm-min"
                    type="number"
                    min="0"
                    className="field mono"
                    value={editing.rules.minAmount}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        rules: { ...editing.rules, minAmount: Number(e.target.value || 0) },
                      })
                    }
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-max">
                    Max USD (0 = none)
                  </label>
                  <input
                    id="pm-max"
                    type="number"
                    min="0"
                    className="field mono"
                    value={editing.rules.maxAmount}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        rules: { ...editing.rules, maxAmount: Number(e.target.value || 0) },
                      })
                    }
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="pm-countries">
                    Allowed countries (blank = all)
                  </label>
                  <input
                    id="pm-countries"
                    className="field"
                    value={countriesText}
                    onChange={(e) => setCountriesText(e.target.value)}
                    placeholder="United States, UK, Ghana"
                  />
                </div>
              </div>

              {/* PROOF SETTINGS */}
              {editing.type !== "automatic" && editing.type !== "cash" && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div className="lbl mb-0">Customer proof requirements</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={editing.proof.required}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            proof: { ...editing.proof, required: e.target.checked },
                          })
                        }
                      />
                      <span>Require proof upload</span>
                    </label>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={editing.proof.fields.screenshot}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            proof: {
                              ...editing.proof,
                              fields: {
                                ...editing.proof.fields,
                                screenshot: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>Receipt screenshot / PDF</span>
                    </label>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={editing.proof.fields.txId}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            proof: {
                              ...editing.proof,
                              fields: {
                                ...editing.proof.fields,
                                txId: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>Transaction ID / Hash</span>
                    </label>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={editing.proof.fields.senderName}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            proof: {
                              ...editing.proof,
                              fields: {
                                ...editing.proof.fields,
                                senderName: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>Sender / account name</span>
                    </label>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={editing.proof.fields.paidAt}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            proof: {
                              ...editing.proof,
                              fields: {
                                ...editing.proof.fields,
                                paidAt: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>Date &amp; time paid</span>
                    </label>
                  </div>

                  <div className="fw" style={{ marginBottom: 0 }}>
                    <label className="lbl" htmlFor="pm-app">
                      Verification mode
                    </label>
                    <select
                      id="pm-app"
                      className="field"
                      value={editing.proof.approval}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          proof: {
                            ...editing.proof,
                            approval: e.target.value as "manual" | "auto",
                          },
                        })
                      }
                    >
                      <option value="manual">Manual admin approval (recommended)</option>
                      <option value="auto">Auto-approve when proof is submitted</option>
                    </select>
                  </div>
                </div>
              )}

              <label className="chk">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) =>
                    setEditing({ ...editing, enabled: e.target.checked })
                  }
                />
                <span>Method enabled and visible at checkout</span>
              </label>

              <button
                type="submit"
                disabled={busy === "save"}
                className="sw-btn sw-btn-em"
              >
                {busy === "save" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save payment method
              </button>
            </form>
          </div>
        )}
      </div>

      {/* PREVIEW AS CUSTOMER MODAL */}
      {previewRecord && (
        <div className="md" role="dialog" aria-modal="true">
          <div className="md-b" onClick={() => setPreviewState(null)} />
          <div className="md-c" style={{ maxWidth: 620 }}>
            <button
              className="md-x"
              onClick={() => setPreviewState(null)}
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
            <div style={{ marginBottom: 12 }}>
              <div className="lbl" style={{ color: "var(--em)" }}>
                Customer checkout preview ($125.00 sample booking)
              </div>
            </div>
            <ManualPaymentPanel payment={previewRecord} compact />
          </div>
        </div>
      )}
    </div>
  );
}
