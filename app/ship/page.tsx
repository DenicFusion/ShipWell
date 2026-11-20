"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Boxes,
  Building2,
  Camera,
  Check,
  Copy,
  CreditCard,
  DollarSign,
  FileText,
  Home as HomeIcon,
  Loader2,
  Package,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  checkAccountExists,
  createShipmentBooking,
  reserveTrackingCode,
} from "@/lib/firestore-shipments";
import {
  prepareShipmentPhoto,
  uploadShipmentPhotoBlob,
  type PreparedPhoto,
} from "@/lib/storage";
import {
  addBusinessDays,
  calculateShippingPricing,
  COUNTRIES,
  formatMoney,
  formatShortDay,
  PLACES,
  SERVICES,
} from "@/lib/quote-engine";
import { normalizeEmail, type ServiceTier, type ShipmentRecord } from "@/types/tracking";
import toast from "react-hot-toast";

function ShipWizardContent() {
  const searchParams = useSearchParams();
  const { user, profile, openAuth, refreshOpenAlerts } = useShipWell();

  const qFrom = searchParams.get("from");
  const qTo = searchParams.get("to");
  const qKg = searchParams.get("kg");
  const qVal = searchParams.get("val");
  const qSvc = searchParams.get("svc") as ServiceTier | null;

  const initSCountry = qFrom && PLACES[qFrom] ? qFrom : "Nigeria";
  const initRCountry = qTo && PLACES[qTo] ? qTo : "United Kingdom";

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Sender & Receiver (nullable overrides autofill cleanly from signed-in profile)
  const [sNameInput, setSNameInput] = useState<string | null>(null);
  const [sPhoneInput, setSPhoneInput] = useState<string | null>(null);
  const [sEmailInput, setSEmailInput] = useState<string | null>(null);
  const sName = sNameInput ?? (profile?.name || user?.displayName || "");
  const sPhone = sPhoneInput ?? (profile?.phone || "");
  const sEmail = sEmailInput ?? (profile?.email || user?.email || "");

  const [sAddr, setSAddr] = useState("");
  const [sCity, setSCity] = useState(PLACES[initSCountry].city);
  const [sPostal, setSPostal] = useState("");
  const [sCountry, setSCountry] = useState(initSCountry);

  const [rName, setRName] = useState("");
  const [rPhone, setRPhone] = useState("");
  const [rEmail, setREmail] = useState("");
  const [rAddr, setRAddr] = useState("");
  const [rCity, setRCity] = useState(PLACES[initRCountry].city);
  const [rPostal, setRPostal] = useState("");
  const [rCountry, setRCountry] = useState(initRCountry);

  // Step 2: Package & Photos
  const [pKg, setPKg] = useState(qKg || "1.5");
  const [pType, setPType] = useState("Parcel");
  const [pL, setPL] = useState("30");
  const [pW, setPW] = useState("20");
  const [pH, setPH] = useState("15");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [pDesc, setPDesc] = useState("");
  const [pVal, setPVal] = useState(qVal || "250");
  const [dragOver, setDragOver] = useState(false);

  // Step 3 & 4
  const [service, setService] = useState<ServiceTier>(
    qSvc && SERVICES[qSvc] ? qSvc : "standard"
  );
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [receiverExists, setReceiverExists] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Completed state
  const [completed, setCompleted] = useState<{
    shipment: ShipmentRecord;
    receiverHasAccount: boolean;
    invitePreview?: { subject: string; html: string; invitePath: string };
  } | null>(null);
  const [showEmailPreview, setShowEmailPreview] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check receiver account existence live when entering Step 4
  useEffect(() => {
    if (step === 4 && rEmail.includes("@")) {
      checkAccountExists(rEmail).then(setReceiverExists);
    }
  }, [step, rEmail]);

  const actualKg = Math.max(0.1, Number(pKg) || 0.1);
  const volKg =
    ((Number(pL) || 0) * (Number(pW) || 0) * (Number(pH) || 0)) / 5000;
  const chargeableKg = Math.max(actualKg, volKg);
  const declaredNum = Math.max(0, Number(pVal) || 0);

  const allQuotes = useMemo(() => {
    return (["economy", "standard", "express"] as ServiceTier[]).map((tier) =>
      calculateShippingPricing(
        sCountry,
        rCountry,
        chargeableKg,
        declaredNum,
        tier
      )
    );
  }, [sCountry, rCountry, chargeableKg, declaredNum]);

  const activeQuote =
    allQuotes.find((q) => q.service === service) || allQuotes[1];

  const handlePhotoFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const slotsLeft = 4 - photos.length;
    if (slotsLeft <= 0) {
      toast("Maximum 4 item photos allowed.");
      return;
    }
    const chosen = Array.from(fileList).slice(0, slotsLeft);
    try {
      const prepared = await Promise.all(chosen.map(prepareShipmentPhoto));
      setPhotos((prev) => [...prev, ...prepared].slice(0, 4));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.photos;
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load image.");
    }
  };

  const validateStep = (targetStep: number): boolean => {
    const e: Record<string, string> = {};
    if (targetStep === 1) {
      if (!sName.trim()) e.sName = "Enter sender name";
      if (sPhone.replace(/\D/g, "").length < 6) e.sPhone = "Enter a valid phone number";
      if (!sEmail.includes("@")) e.sEmail = "Enter a valid email";
      if (!sAddr.trim()) e.sAddr = "Enter sender street address";
      if (!sCity.trim()) e.sCity = "Enter sender city";
      if (!rName.trim()) e.rName = "Enter recipient name";
      if (rPhone.replace(/\D/g, "").length < 6) e.rPhone = "Enter a valid phone number";
      if (!rEmail.includes("@")) e.rEmail = "Receiver email is required";
      if (!rAddr.trim()) e.rAddr = "Enter recipient street address";
      if (!rCity.trim()) e.rCity = "Enter recipient city";
    } else if (targetStep === 2) {
      if (!(Number(pKg) > 0)) e.pKg = "Enter a weight above 0";
      if (photos.length === 0) e.photos = "Please add at least one photo of the item.";
      if (!pDesc.trim()) e.pDesc = "Describe the item contents";
      if (pVal === "" || Number(pVal) < 0) e.pVal = "Enter declared value";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Please check the highlighted fields.");
      return false;
    }
    return true;
  };

  const executeBooking = async (uid: string) => {
    setSubmitting(true);
    try {
      const code = await reserveTrackingCode();
      const uploadedPhotoUrls = await Promise.all(
        photos.map((photo, index) =>
          uploadShipmentPhotoBlob({
            code,
            index,
            blob: photo.blob,
            fallbackDataUrl: photo.fallbackDataUrl,
          })
        )
      );

      const result = await createShipmentBooking({
        code,
        senderId: uid,
        sender: {
          name: sName,
          email: sEmail,
          phone: sPhone,
          address: sAddr,
          city: sCity,
          postal: sPostal,
          country: sCountry,
        },
        receiver: {
          name: rName,
          email: rEmail,
          phone: rPhone,
          address: rAddr,
          city: rCity,
          postal: rPostal,
          country: rCountry,
        },
        service,
        weightKg: chargeableKg,
        packageType: pType,
        contents: pDesc,
        declaredValue: declaredNum,
        paymentMethod,
        photos: uploadedPhotoUrls,
      });
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      await refreshOpenAlerts();
      setCompleted(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success(`Shipment ${result.shipment.code} booked!`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not complete booking."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!termsAccepted) {
      setErrors({ terms: "Please accept the terms to continue" });
      toast.error("Please accept the terms of carriage.");
      return;
    }
    setErrors({});
    if (!user) {
      openAuth({
        mode: "signup",
        prompt:
          "Create a free ShipWell account to confirm your booking and track your parcels.",
        prefillEmail: sEmail,
        prefillName: sName,
        prefillPhone: sPhone,
        onDone: async (authedUser) => {
          await executeBooking(authedUser.uid);
        },
      });
      return;
    }
    await executeBooking(user.uid);
  };

  if (completed) {
    const s = completed.shipment;
    return (
      <div className="wrap">
        <div className="done">
          <div className="tick">
            <Check className="w-9 h-9" />
          </div>
          <div className="eyebrow c">Booking confirmed</div>
          <h1
            className="bebas"
            style={{
              fontWeight: 400,
              fontSize: "clamp(2.4rem,9vw,4rem)",
              lineHeight: 0.95,
              marginBottom: 12,
            }}
          >
            YOUR SHIPMENT
            <br />
            IS BOOKED
          </h1>
          <p className="lead">
            {completed.receiverHasAccount
              ? `We notified ${s.receiver.email} — this parcel is already on their ShipWell dashboard.`
              : `We sent an email invite to ${s.receiver.email} so they can create a free account and follow ${s.code}.`}{" "}
            Keep your tracking number safe.
          </p>

          <div className="ticket">
            <div className="tt">
              <small>Tracking number</small>
              <div className="code">{s.code}</div>
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                onClick={() => {
                  navigator.clipboard.writeText(s.code);
                  toast.success("Tracking number copied!");
                }}
              >
                <Copy className="w-4 h-4" />
                Copy number
              </button>
            </div>
            <div className="tb2">
              <div>
                <small>Route</small>
                <b>
                  {s.sender.city} → {s.receiver.city}
                </b>
              </div>
              <div>
                <small>Estimated delivery</small>
                <b>by {formatShortDay(s.eta)}</b>
              </div>
              <div>
                <small>Service</small>
                <b>{SERVICES[s.service].name}</b>
              </div>
              <div>
                <small>Total paid</small>
                <b>{formatMoney(s.priceTotal)}</b>
              </div>
            </div>
          </div>

          <div className="acts" style={{ justifyContent: "center" }}>
            <Link
              className="sw-btn sw-btn-em sw-btn-lg"
              href={`/track/${s.code}`}
            >
              Track Shipment →
            </Link>
            <Link className="sw-btn sw-btn-ghost sw-btn-lg" href="/dashboard">
              My dashboard
            </Link>
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-lg"
              onClick={() => {
                setCompleted(null);
                setStep(1);
                setPhotos([]);
                setPDesc("");
              }}
            >
              Book another
            </button>
          </div>

          {completed.invitePreview && (
            <div style={{ marginTop: 28, textAlign: "left" }}>
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                style={{ fontSize: 12.5, padding: "8px 14px" }}
                onClick={() => setShowEmailPreview((p) => !p)}
              >
                {showEmailPreview ? "Hide" : "Inspect"} recipient email &amp; invite link
              </button>
              {showEmailPreview && (
                <div
                  className="panel"
                  style={{ marginTop: 12, padding: 16 }}
                >
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                    <b>Subject:</b> {completed.invitePreview.subject}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, wordBreak: "break-all" }}>
                    <b>Invite link:</b>{" "}
                    <Link
                      href={completed.invitePreview.invitePath}
                      style={{ color: "var(--em)", textDecoration: "underline" }}
                    >
                      {completed.invitePreview.invitePath}
                    </Link>
                  </div>
                  <iframe
                    title="Receiver email preview"
                    srcDoc={completed.invitePreview.html}
                    style={{
                      width: "100%",
                      height: 440,
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      background: "#07090F",
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="phead">
        <div className="eyebrow">Ship Now</div>
        <h1>
          BOOK YOUR
          <br />
          SHIPMENT
        </h1>
        <p>
          Four quick steps. Live pricing updates as you go and your tracking
          number is issued instantly.
        </p>
      </div>

      <div className="ship-grid">
        <div>
          {/* PROGRESS STEPS */}
          <div className="prog">
            {[
              { n: 1, label: "Addresses" },
              { n: 2, label: "Package" },
              { n: 3, label: "Service" },
              { n: 4, label: "Confirm" },
            ].map((item) => {
              const cls =
                step > item.n ? "done" : step === item.n ? "active" : "";
              return (
                <div key={item.n} className={`ps ${cls}`}>
                  <div className="pc">
                    {step > item.n ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <span>{item.n}</span>
                    )}
                  </div>
                  <small>{item.label}</small>
                </div>
              );
            })}
          </div>

          {/* STEP 1 */}
          {step === 1 && (
            <div>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-h">
                  <div className="pi">
                    <Package className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Sender</b>
                    <small>Where we collect from</small>
                  </div>
                </div>
                <div className="panel-b">
                  <div className="g2">
                    <div className={`fw ${errors.sName ? "err" : ""}`}>
                      <label className="lbl" htmlFor="sName">
                        Full name
                      </label>
                      <input
                        id="sName"
                        className="field"
                        value={sName}
                        onChange={(e) => setSNameInput(e.target.value)}
                        placeholder="Adaeze Okafor"
                      />
                      {errors.sName && (
                        <span className="ferr">{errors.sName}</span>
                      )}
                    </div>
                    <div className={`fw ${errors.sPhone ? "err" : ""}`}>
                      <label className="lbl" htmlFor="sPhone">
                        Phone
                      </label>
                      <input
                        id="sPhone"
                        className="field"
                        type="tel"
                        value={sPhone}
                        onChange={(e) => setSPhoneInput(e.target.value)}
                        placeholder="+234 800 000 0000"
                      />
                      {errors.sPhone && (
                        <span className="ferr">{errors.sPhone}</span>
                      )}
                    </div>
                  </div>

                  <div className={`fw ${errors.sEmail ? "err" : ""}`}>
                    <label className="lbl" htmlFor="sEmail">
                      Email (for your receipt)
                    </label>
                    <input
                      id="sEmail"
                      className="field"
                      type="email"
                      value={sEmail}
                      onChange={(e) => setSEmailInput(e.target.value)}
                      placeholder="you@company.com"
                    />
                    {errors.sEmail && (
                      <span className="ferr">{errors.sEmail}</span>
                    )}
                  </div>

                  <div className={`fw ${errors.sAddr ? "err" : ""}`}>
                    <label className="lbl" htmlFor="sAddr">
                      Street address
                    </label>
                    <input
                      id="sAddr"
                      className="field"
                      value={sAddr}
                      onChange={(e) => setSAddr(e.target.value)}
                      placeholder="14 Adeola Odeku Street"
                    />
                    {errors.sAddr && (
                      <span className="ferr">{errors.sAddr}</span>
                    )}
                  </div>

                  <div className="g3">
                    <div className={`fw ${errors.sCity ? "err" : ""}`}>
                      <label className="lbl" htmlFor="sCity">
                        City
                      </label>
                      <input
                        id="sCity"
                        className="field"
                        value={sCity}
                        onChange={(e) => setSCity(e.target.value)}
                        placeholder="Lagos"
                      />
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="sPostal">
                        Postal code
                      </label>
                      <input
                        id="sPostal"
                        className="field"
                        value={sPostal}
                        onChange={(e) => setSPostal(e.target.value)}
                        placeholder="101241"
                      />
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="sCountry">
                        Country
                      </label>
                      <select
                        id="sCountry"
                        className="field"
                        value={sCountry}
                        onChange={(e) => {
                          const c = e.target.value;
                          setSCountry(c);
                          if (PLACES[c]) setSCity(PLACES[c].city);
                        }}
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <div className="pi">
                    <HomeIcon className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Recipient</b>
                    <small>Where it&apos;s going</small>
                  </div>
                </div>
                <div className="panel-b">
                  <div className="g2">
                    <div className={`fw ${errors.rName ? "err" : ""}`}>
                      <label className="lbl" htmlFor="rName">
                        Full name
                      </label>
                      <input
                        id="rName"
                        className="field"
                        value={rName}
                        onChange={(e) => setRName(e.target.value)}
                        placeholder="Jonas Weber"
                      />
                      {errors.rName && (
                        <span className="ferr">{errors.rName}</span>
                      )}
                    </div>
                    <div className={`fw ${errors.rPhone ? "err" : ""}`}>
                      <label className="lbl" htmlFor="rPhone">
                        Phone
                      </label>
                      <input
                        id="rPhone"
                        className="field"
                        type="tel"
                        value={rPhone}
                        onChange={(e) => setRPhone(e.target.value)}
                        placeholder="+49 30 000 0000"
                      />
                      {errors.rPhone && (
                        <span className="ferr">{errors.rPhone}</span>
                      )}
                    </div>
                  </div>

                  <div className={`fw ${errors.rEmail ? "err" : ""}`}>
                    <label className="lbl" htmlFor="rEmail">
                      Receiver email
                    </label>
                    <input
                      id="rEmail"
                      className="field"
                      type="email"
                      value={rEmail}
                      onChange={(e) => setREmail(e.target.value)}
                      placeholder="receiver@email.com"
                      required
                    />
                    <small
                      style={{
                        display: "block",
                        marginTop: 4,
                        color: "var(--muted)",
                        fontSize: 12,
                      }}
                    >
                      When the receiver signs up with this email, the parcel
                      appears on their dashboard.
                    </small>
                    {errors.rEmail && (
                      <span className="ferr">{errors.rEmail}</span>
                    )}
                  </div>

                  <div className={`fw ${errors.rAddr ? "err" : ""}`}>
                    <label className="lbl" htmlFor="rAddr">
                      Street address
                    </label>
                    <input
                      id="rAddr"
                      className="field"
                      value={rAddr}
                      onChange={(e) => setRAddr(e.target.value)}
                      placeholder="Friedrichstraße 112"
                    />
                    {errors.rAddr && (
                      <span className="ferr">{errors.rAddr}</span>
                    )}
                  </div>

                  <div className="g3">
                    <div className={`fw ${errors.rCity ? "err" : ""}`}>
                      <label className="lbl" htmlFor="rCity">
                        City
                      </label>
                      <input
                        id="rCity"
                        className="field"
                        value={rCity}
                        onChange={(e) => setRCity(e.target.value)}
                        placeholder="London"
                      />
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="rPostal">
                        Postal code
                      </label>
                      <input
                        id="rPostal"
                        className="field"
                        value={rPostal}
                        onChange={(e) => setRPostal(e.target.value)}
                        placeholder="EC2N 4BQ"
                      />
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="rCountry">
                        Country
                      </label>
                      <select
                        id="rCountry"
                        className="field"
                        value={rCountry}
                        onChange={(e) => {
                          const c = e.target.value;
                          setRCountry(c);
                          if (PLACES[c]) setRCity(PLACES[c].city);
                        }}
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="acts">
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  onClick={() => {
                    if (validateStep(1)) {
                      setStep(2);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                >
                  Continue to Package →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div className="panel">
                <div className="panel-h">
                  <div className="pi">
                    <Boxes className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Package details</b>
                    <small>
                      Chargeable weight uses the higher of actual and
                      volumetric
                    </small>
                  </div>
                </div>
                <div className="panel-b">
                  <div className="g2">
                    <div className={`fw ${errors.pKg ? "err" : ""}`}>
                      <label className="lbl" htmlFor="pKg">
                        Weight (kg)
                      </label>
                      <input
                        id="pKg"
                        className="field"
                        type="number"
                        inputMode="decimal"
                        min="0.1"
                        step="0.1"
                        value={pKg}
                        onChange={(e) => setPKg(e.target.value)}
                      />
                      {errors.pKg && (
                        <span className="ferr">{errors.pKg}</span>
                      )}
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="pType">
                        Package type
                      </label>
                      <select
                        id="pType"
                        className="field"
                        value={pType}
                        onChange={(e) => setPType(e.target.value)}
                      >
                        <option>Parcel</option>
                        <option>Document envelope</option>
                        <option>Box</option>
                        <option>Pallet</option>
                      </select>
                    </div>
                  </div>

                  <div className="g3">
                    <div className="fw">
                      <label className="lbl" htmlFor="pL">
                        Length (cm)
                      </label>
                      <input
                        id="pL"
                        className="field"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={pL}
                        onChange={(e) => setPL(e.target.value)}
                      />
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="pW">
                        Width (cm)
                      </label>
                      <input
                        id="pW"
                        className="field"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={pW}
                        onChange={(e) => setPW(e.target.value)}
                      />
                    </div>
                    <div className="fw">
                      <label className="lbl" htmlFor="pH">
                        Height (cm)
                      </label>
                      <input
                        id="pH"
                        className="field"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={pH}
                        onChange={(e) => setPH(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={`fw ${errors.photos ? "err" : ""}`}>
                    <label className="lbl">
                      Item photos (1–4 required){" "}
                      <span style={{ float: "right", color: "var(--muted)" }}>
                        {photos.length} / 4
                      </span>
                    </label>
                    <label
                      className={`pf-zone ${dragOver ? "over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        handlePhotoFiles(e.dataTransfer.files);
                      }}
                    >
                      <Camera className="w-[26px] h-[26px] text-[var(--em)]" />
                      <b>Tap or drag photos to upload</b>
                      <small>
                        The receiver and operations reviewer will see these.
                        JPG/PNG, up to 4.
                      </small>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => handlePhotoFiles(e.target.files)}
                      />
                    </label>

                    {photos.length > 0 && (
                      <div className="pf-grid">
                        {photos.map((item, idx) => (
                          <div key={item.previewUrl} className="pf-th">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.previewUrl} alt={`Uploaded item ${idx + 1}`} />
                            <button
                              type="button"
                              aria-label="Remove photo"
                              onClick={() => {
                                URL.revokeObjectURL(item.previewUrl);
                                setPhotos((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                );
                              }}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {errors.photos && (
                      <span className="ferr">{errors.photos}</span>
                    )}
                  </div>

                  <div className={`fw ${errors.pDesc ? "err" : ""}`}>
                    <label className="lbl" htmlFor="pDesc">
                      Contents
                    </label>
                    <input
                      id="pDesc"
                      className="field"
                      value={pDesc}
                      onChange={(e) => setPDesc(e.target.value)}
                      placeholder="e.g. Laptop, 2× ankara garments"
                    />
                    {errors.pDesc && (
                      <span className="ferr">{errors.pDesc}</span>
                    )}
                  </div>

                  <div className={`fw ${errors.pVal ? "err" : ""}`}>
                    <label className="lbl" htmlFor="pVal">
                      Declared value (USD)
                    </label>
                    <input
                      id="pVal"
                      className="field"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={pVal}
                      onChange={(e) => setPVal(e.target.value)}
                    />
                    {errors.pVal && (
                      <span className="ferr">{errors.pVal}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="acts">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  onClick={() => setStep(1)}
                >
                  ← Back
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  onClick={() => {
                    if (validateStep(2)) {
                      setStep(3);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                >
                  Choose Service →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div>
              <div className="panel">
                <div className="panel-h">
                  <div className="pi">
                    <Zap className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Select service</b>
                    <small>
                      {sCity} → {rCity} ({activeQuote.dist.toLocaleString()} km)
                    </small>
                  </div>
                </div>
                <div className="panel-b">
                  <div className="svc">
                    {allQuotes.map((q) => {
                      const meta = SERVICES[q.service];
                      const isSel = q.service === service;
                      const estDate = formatShortDay(
                        addBusinessDays(new Date(), q.days[1] + 1)
                      );
                      return (
                        <button
                          key={q.service}
                          type="button"
                          className={`so ${isSel ? "sel" : ""}`}
                          onClick={() => setService(q.service)}
                        >
                          <div className="rd" />
                          <div className="info">
                            <b>
                              {meta.name}
                              {meta.popular && <i>Most popular</i>}
                            </b>
                            <small>
                              {meta.blurb} · {q.days[0]}–{q.days[1]} business days
                              (by {estDate})
                            </small>
                          </div>
                          <div className="pr">
                            <b>{formatMoney(q.total)}</b>
                            <small>all-in</small>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="acts">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  onClick={() => setStep(2)}
                >
                  ← Back
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  onClick={() => {
                    setStep(4);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Review Booking →
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-h">
                  <div className="pi">
                    <FileText className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Review &amp; confirm</b>
                    <small>Check everything before confirming</small>
                  </div>
                </div>
                <div className="panel-b">
                  <div className="rv">
                    <div className="r">
                      <span>From</span>
                      <b>
                        {sName} · {sAddr}, {sCity}, {sCountry}
                      </b>
                    </div>
                    <div className="r">
                      <span>To</span>
                      <b>
                        {rName} · {rAddr}, {rCity}, {rCountry}
                      </b>
                    </div>
                    <div className="r">
                      <span>Receiver email</span>
                      <b>
                        {normalizeEmail(rEmail)}{" "}
                        {receiverExists === true ? (
                          <span className="chip g" style={{ marginLeft: 6 }}>
                            Already on ShipWell
                          </span>
                        ) : (
                          <span className="chip a" style={{ marginLeft: 6 }}>
                            Will see it once they sign up
                          </span>
                        )}
                      </b>
                    </div>
                    <hr />
                    <div className="r">
                      <span>Package</span>
                      <b>
                        {pType} · {chargeableKg.toFixed(1)} kg
                      </b>
                    </div>
                    <div className="r">
                      <span>Contents</span>
                      <b>{pDesc}</b>
                    </div>
                    <div className="r">
                      <span>Service</span>
                      <b>
                        {SERVICES[service].name} · est. by{" "}
                        {formatShortDay(
                          addBusinessDays(new Date(), activeQuote.days[1] + 1)
                        )}
                      </b>
                    </div>
                    <hr />
                    <div className="r">
                      <span>Item photos ({photos.length})</span>
                      <div className="flex gap-2 justify-end flex-wrap">
                        {photos.map((item, i) => (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            key={item.previewUrl}
                            src={item.previewUrl}
                            alt={`Item ${i + 1}`}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 8,
                              objectFit: "cover",
                              border: "1px solid var(--border)",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <div className="pi">
                    <DollarSign className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Payment method</b>
                    <small>Select how you wish to settle this shipment</small>
                  </div>
                </div>
                <div className="panel-b">
                  <div className="pay">
                    {[
                      { label: "Card", icon: CreditCard },
                      { label: "Bank transfer", icon: Building2 },
                      { label: "Pay on pickup", icon: Truck },
                    ].map((pm) => {
                      const Icon = pm.icon;
                      return (
                        <label key={pm.label}>
                          <input
                            type="radio"
                            name="pay"
                            value={pm.label}
                            checked={paymentMethod === pm.label}
                            onChange={() => setPaymentMethod(pm.label)}
                          />
                          <span>
                            <Icon className="w-5 h-5" />
                            {pm.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div className={`fw ${errors.terms ? "err" : ""}`}>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                      />
                      <span>
                        I confirm the contents are accurate and I accept
                        ShipWell&apos;s terms of carriage and prohibited-items
                        policy.
                      </span>
                    </label>
                    {errors.terms && (
                      <span className="ferr">{errors.terms}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="acts">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  onClick={() => setStep(3)}
                >
                  ← Back
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  disabled={submitting}
                  onClick={handleConfirm}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Confirm Booking
                </button>
              </div>
            </div>
          )}
        </div>

        {/* LIVE SUMMARY SIDEBAR */}
        <aside className="side">
          <div className="panel">
            <div className="sum-h">
              <b>Shipment summary</b>
              <small>Updates as you type</small>
            </div>
            <div className="sum-b">
              <div className="sr">
                <span>Route</span>
                <b>
                  {sCity} → {rCity}
                </b>
              </div>
              <div className="sr">
                <span>Chargeable</span>
                <b>{chargeableKg.toFixed(1)} kg</b>
              </div>
              <div className="sr">
                <span>Service</span>
                <b>{SERVICES[service].name}</b>
              </div>
              <div className="sr">
                <span>Transit</span>
                <b>
                  {activeQuote.days[0]}–{activeQuote.days[1]} business days
                </b>
              </div>
              <hr />
              <div className="sr">
                <span>Base freight</span>
                <b>{formatMoney(activeQuote.base)}</b>
              </div>
              <div className="sr">
                <span>Fuel (12%)</span>
                <b>{formatMoney(activeQuote.fuel)}</b>
              </div>
              <div className="sr">
                <span>Transit cover</span>
                <b>{formatMoney(activeQuote.cover)}</b>
              </div>
              {activeQuote.intl && (
                <div className="sr">
                  <span>Customs handling</span>
                  <b>{formatMoney(activeQuote.duty)}</b>
                </div>
              )}
              <hr />
              <div className="sum-tot">
                <span>Total</span>
                <b>{formatMoney(activeQuote.total)}</b>
              </div>
              <div className="note">
                Price locked for 24 hours. Import duties and taxes at
                destination may apply.
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* MOBILE STICKY BAR */}
      <div className="mbar">
        <div>
          <small>Step {step} of 4</small>
          <b>{formatMoney(activeQuote.total)}</b>
        </div>
        <span className="chip g">{SERVICES[service].name}</span>
      </div>
    </div>
  );
}

export default function ShipPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main ship flex-1">
        <Suspense
          fallback={
            <div className="wrap py-24 text-center text-[var(--muted)]">
              Loading booking wizard...
            </div>
          }
        >
          <ShipWizardContent />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
