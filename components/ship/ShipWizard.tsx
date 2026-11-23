import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import {
  AlertCircle,
  Boxes,
  Camera,
  Check,
  Copy,
  CreditCard,
  DollarSign,
  ExternalLink,
  FileText,
  Home as HomeIcon,
  Loader2,
  Lock,
  Package,
  RefreshCw,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { PhoneField } from "@/components/PhoneField";
import { openBachsOverlay } from "@/lib/bachs-overlay";
import { db } from "@/lib/firebase";
import {
  checkAccountExists,
  fetchFullShipmentBundle,
  reserveTrackingCode,
} from "@/lib/firestore-shipments";
import { countryNameToIso2, validateInternationalPhone } from "@/lib/phone";
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
  getDefaultOriginCountry,
  PLACES,
  SERVICES,
} from "@/lib/quote-engine";
import {
  normalizeEmail,
  type BookingRecord,
  type ServiceTier,
  type ShipmentRecord,
} from "@/types/tracking";
import toast from "react-hot-toast";

const DRAFT_KEY = "shipwell_ship_draft_v1";

interface ShipDraft {
  step: number;
  sNameInput: string | null;
  sPhoneInput: string | null;
  sEmailInput: string | null;
  sAddr: string;
  sCity: string;
  sPostal: string;
  sCountry: string;
  rName: string;
  rPhone: string;
  rEmail: string;
  rAddr: string;
  rCity: string;
  rPostal: string;
  rCountry: string;
  pKg: string;
  pType: string;
  pL: string;
  pW: string;
  pH: string;
  pDesc: string;
  pVal: string;
  service: ServiceTier;
  paymentMethod: "Pay now" | "Pay on delivery";
}

function readDraft(): Partial<ShipDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<ShipDraft>) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: ShipDraft) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota errors
  }
}

function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

function focusField(fieldId: string) {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus?.();
    }
  }, 60);
}

export function ShipWizard({ embedded = false }: { embedded?: boolean }) {
  const [searchParams] = useSearchParams();
  const { user, profile, authReady, openAuth, refreshOpenAlerts } = useShipWell();
  const promptedRef = useRef(false);
  const submitLockRef = useRef(false);
  const unsubBookingRef = useRef<(() => void) | null>(null);
  const unsubShipmentRef = useRef<(() => void) | null>(null);

  const qFrom = searchParams.get("from");
  const qTo = searchParams.get("to");
  const qKg = searchParams.get("kg");
  const qVal = searchParams.get("val");
  const qSvc = searchParams.get("svc") as ServiceTier | null;
  const cancelledQuery = searchParams.get("cancelled") === "1";

  const draft = useMemo(() => readDraft(), []);
  const fallbackOrigin = useMemo(() => getDefaultOriginCountry(), []);
  const fallbackDest =
    fallbackOrigin === "United Kingdom" ? "United States" : "United Kingdom";

  const initSCountry =
    qFrom && PLACES[qFrom]
      ? qFrom
      : draft?.sCountry && PLACES[draft.sCountry]
        ? draft.sCountry
        : fallbackOrigin;
  const initRCountry =
    qTo && PLACES[qTo]
      ? qTo
      : draft?.rCountry && PLACES[draft.rCountry]
        ? draft.rCountry
        : initSCountry === "United Kingdom"
          ? "United States"
          : fallbackDest;

  const [step, setStep] = useState<number>(() => {
    if (cancelledQuery) return 4;
    if (draft?.step && draft.step >= 1 && draft.step <= 4) return draft.step;
    return 1;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [cancelNotice, setCancelNotice] = useState(
    cancelledQuery
      ? "Payment not completed — your details are preserved."
      : ""
  );

  // Step 1
  const [sNameInput, setSNameInput] = useState<string | null>(
    draft?.sNameInput ?? null
  );
  const [sPhoneInput, setSPhoneInput] = useState<string | null>(
    draft?.sPhoneInput ?? null
  );
  const [sEmailInput, setSEmailInput] = useState<string | null>(
    draft?.sEmailInput ?? null
  );
  const sName = sNameInput ?? (profile?.name || user?.displayName || "");
  const sPhone = sPhoneInput ?? (profile?.phone || "");
  const sEmail = sEmailInput ?? (profile?.email || user?.email || "");

  const [sAddr, setSAddr] = useState(draft?.sAddr || "");
  const [sCity, setSCity] = useState(
    draft?.sCity && !qFrom ? draft.sCity : PLACES[initSCountry].city
  );
  const [sPostal, setSPostal] = useState(draft?.sPostal || "");
  const [sCountry, setSCountry] = useState(initSCountry);

  const [rName, setRName] = useState(draft?.rName || "");
  const [rPhone, setRPhone] = useState(draft?.rPhone || "");
  const [rEmail, setREmail] = useState(draft?.rEmail || "");
  const [rAddr, setRAddr] = useState(draft?.rAddr || "");
  const [rCity, setRCity] = useState(
    draft?.rCity && !qTo ? draft.rCity : PLACES[initRCountry].city
  );
  const [rPostal, setRPostal] = useState(draft?.rPostal || "");
  const [rCountry, setRCountry] = useState(initRCountry);

  // Step 2
  const [pKg, setPKg] = useState(qKg || draft?.pKg || "1.5");
  const [pType, setPType] = useState(draft?.pType || "Parcel");
  const [pL, setPL] = useState(draft?.pL || "30");
  const [pW, setPW] = useState(draft?.pW || "20");
  const [pH, setPH] = useState(draft?.pH || "15");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [pDesc, setPDesc] = useState(draft?.pDesc || "");
  const [pVal, setPVal] = useState(qVal || draft?.pVal || "250");
  const [dragOver, setDragOver] = useState(false);

  // Step 3 & 4
  const [service, setService] = useState<ServiceTier>(
    qSvc && SERVICES[qSvc]
      ? qSvc
      : draft?.service && SERVICES[draft.service]
        ? draft.service
        : "standard"
  );
  const [paymentMethod, setPaymentMethod] = useState<
    "Pay now" | "Pay on delivery"
  >(draft?.paymentMethod === "Pay on delivery" ? "Pay on delivery" : "Pay now");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [receiverExists, setReceiverExists] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Checkout options from server
  const [checkoutOptions, setCheckoutOptions] = useState<{
    bachsEnabled: boolean;
    bachsProductConfigured: boolean;
    payOnPickupEnabled: boolean;
  }>({
    bachsEnabled: true,
    bachsProductConfigured: true,
    payOnPickupEnabled: true,
  });

  // Live confirmation state (for Bachs overlay / fallback -> webhook completion)
  const [confirmingPayment, setConfirmingPayment] = useState<{
    bookingId: string;
    trackingCode: string;
    totalUsd: number;
    checkoutUrl: string;
    overlayOpened: boolean;
    statusMessage: string;
    fallbackNotice?: string;
    timedOut?: boolean;
  } | null>(null);

  // Completed state
  const [completed, setCompleted] = useState<{
    shipment: ShipmentRecord;
    receiverHasAccount: boolean;
    paymentStatusLabel: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist draft in sessionStorage
  useEffect(() => {
    if (completed) return;
    saveDraft({
      step,
      sNameInput,
      sPhoneInput,
      sEmailInput,
      sAddr,
      sCity,
      sPostal,
      sCountry,
      rName,
      rPhone,
      rEmail,
      rAddr,
      rCity,
      rPostal,
      rCountry,
      pKg,
      pType,
      pL,
      pW,
      pH,
      pDesc,
      pVal,
      service,
      paymentMethod,
    });
  }, [
    completed,
    step,
    sNameInput,
    sPhoneInput,
    sEmailInput,
    sAddr,
    sCity,
    sPostal,
    sCountry,
    rName,
    rPhone,
    rEmail,
    rAddr,
    rCity,
    rPostal,
    rCountry,
    pKg,
    pType,
    pL,
    pW,
    pH,
    pDesc,
    pVal,
    service,
    paymentMethod,
  ]);

  // Fetch enabled payment options
  useEffect(() => {
    let active = true;
    fetch("/api/checkout/options")
      .then((r) => r.json())
      .then((data) => {
        if (!active || !data || typeof data.bachsEnabled !== "boolean") return;
        const nextOpts = {
          bachsEnabled: Boolean(data.bachsEnabled),
          bachsProductConfigured: Boolean(data.bachsProductConfigured),
          payOnPickupEnabled: Boolean(data.payOnPickupEnabled),
        };
        setCheckoutOptions(nextOpts);
        setPaymentMethod((prev) => {
          if (!nextOpts.bachsEnabled && prev === "Pay now" && nextOpts.payOnPickupEnabled) {
            return "Pay on delivery";
          }
          if (!nextOpts.payOnPickupEnabled && prev === "Pay on delivery" && nextOpts.bachsEnabled) {
            return "Pay now";
          }
          return prev;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Check receiver account existence live when entering Step 4
  useEffect(() => {
    if (step === 4 && rEmail.includes("@")) {
      checkAccountExists(rEmail).then(setReceiverExists);
    }
  }, [step, rEmail]);

  useEffect(() => {
    if (authReady && !user && !promptedRef.current) {
      promptedRef.current = true;
      openAuth({
        mode: "login",
        prompt:
          "Log in or create a free account to ship a parcel. Your tracking number and the receiver link are kept on your account.",
      });
    }
  }, [authReady, user, openAuth]);

  // Cleanup active Firestore listeners on unmount
  const cleanupBookingListeners = useCallback(() => {
    unsubBookingRef.current?.();
    unsubBookingRef.current = null;
    unsubShipmentRef.current?.();
    unsubShipmentRef.current = null;
  }, []);

  useEffect(() => {
    return () => cleanupBookingListeners();
  }, [cleanupBookingListeners]);

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

  const getStep1Errors = useCallback(() => {
    const e: Record<string, string> = {};
    if (!sName.trim()) e.sName = "Enter sender full name";
    const sPhoneCheck = validateInternationalPhone(
      sPhone,
      countryNameToIso2(sCountry)
    );
    if (!sPhoneCheck.valid) e.sPhone = sPhoneCheck.error || "Enter valid sender phone";
    if (!sEmail.includes("@")) e.sEmail = "Enter valid sender email";
    if (!sAddr.trim()) e.sAddr = "Enter sender street address";
    if (!sCity.trim()) e.sCity = "Enter sender city";

    if (!rName.trim()) e.rName = "Enter recipient full name";
    const rPhoneCheck = validateInternationalPhone(
      rPhone,
      countryNameToIso2(rCountry)
    );
    if (!rPhoneCheck.valid) e.rPhone = rPhoneCheck.error || "Enter valid receiver phone";
    if (!rEmail.includes("@")) e.rEmail = "Receiver email is required";
    if (!rAddr.trim()) e.rAddr = "Enter recipient street address";
    if (!rCity.trim()) e.rCity = "Enter recipient city";
    return e;
  }, [
    sName,
    sPhone,
    sCountry,
    sEmail,
    sAddr,
    sCity,
    rName,
    rPhone,
    rCountry,
    rEmail,
    rAddr,
    rCity,
  ]);

  const getStep2Errors = useCallback(() => {
    const e: Record<string, string> = {};
    if (!(Number(pKg) > 0)) e.pKg = "Enter weight above 0 kg";
    if (photos.length === 0) e.photos = "Upload at least 1 item photo (1–4)";
    if (!pDesc.trim()) e.pDesc = "Describe parcel contents";
    if (pVal === "" || Number(pVal) < 0) e.pVal = "Enter declared value";
    return e;
  }, [pKg, photos.length, pDesc, pVal]);

  const step1Issues = useMemo(() => getStep1Errors(), [getStep1Errors]);
  const step2Issues = useMemo(() => getStep2Errors(), [getStep2Errors]);
  const allPreviousValid =
    Object.keys(step1Issues).length === 0 &&
    Object.keys(step2Issues).length === 0;

  const validateStep = (targetStep: number): boolean => {
    const e = targetStep === 1 ? getStep1Errors() : getStep2Errors();
    setErrors(e);
    const keys = Object.keys(e);
    if (keys.length > 0) {
      toast.error("Please fix the highlighted fields.");
      focusField(keys[0]);
      return false;
    }
    return true;
  };

  const finishBookingSuccess = useCallback(
    async (
      trackingCode: string,
      paymentStatusLabel: string,
      fallbackShipment?: ShipmentRecord
    ) => {
      cleanupBookingListeners();
      let liveShipment = fallbackShipment || null;
      if (!liveShipment) {
        liveShipment = await fetchFullShipmentBundle(trackingCode).catch(() => null);
      }
      if (!liveShipment) {
        setConfirmingPayment(null);
        setSubmitError(
          `Booking ${trackingCode} was recorded, but live shipment details could not load yet. Open Track to view it.`
        );
        return;
      }
      const recHasAccount = await checkAccountExists(
        liveShipment.receiverEmail
      ).catch(() => false);
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      clearDraft();
      await refreshOpenAlerts().catch(() => undefined);
      setConfirmingPayment(null);
      setCompleted({
        shipment: liveShipment,
        receiverHasAccount: recHasAccount,
        paymentStatusLabel,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success(`Shipment ${liveShipment.code} booked!`);
    },
    [cleanupBookingListeners, photos, refreshOpenAlerts]
  );

  const attachBookingListeners = useCallback(
    (bookingId: string, trackingCode: string) => {
      cleanupBookingListeners();
      const timeoutHandle = window.setTimeout(() => {
        setConfirmingPayment((prev) =>
          prev ? { ...prev, timedOut: true } : prev
        );
      }, 25000);

      const unsubBooking = onSnapshot(
        doc(db, "bookings", bookingId),
        (snap) => {
          if (!snap.exists()) return;
          const b = snap.data() as BookingRecord;
          if (b.paymentStatus === "paid") {
            window.clearTimeout(timeoutHandle);
            finishBookingSuccess(trackingCode, "Paid").catch(() => undefined);
          } else if (
            b.paymentStatus === "failed" ||
            b.paymentStatus === "expired" ||
            b.bookingStatus === "cancelled" ||
            b.bookingStatus === "expired"
          ) {
            window.clearTimeout(timeoutHandle);
            cleanupBookingListeners();
            setConfirmingPayment(null);
            setSubmitError(
              "Payment was not completed. Your details are preserved — please try again."
            );
          }
        },
        () => undefined
      );

      unsubBookingRef.current = () => {
        window.clearTimeout(timeoutHandle);
        unsubBooking();
      };
    },
    [cleanupBookingListeners, finishBookingSuccess]
  );

  const executeBooking = async (
    uid: string,
    freshIdToken?: string
  ) => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    setCancelNotice("");

    const attemptKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `bk_${crypto.randomUUID()}`
        : `bk_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

    const controller = new AbortController();
    let timerHandle: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerHandle = window.setTimeout(() => {
        controller.abort();
        reject(new Error("BOOKING_TIMEOUT"));
      }, 30000);
    });

    try {
      console.log("[ShipWizard] Starting booking", {
        paymentMethod,
        attemptKey,
        photoCount: photos.length,
      });

      const runBookingSteps = async () => {
        const token =
          freshIdToken || (await user?.getIdToken().catch(() => null)) || "";
        if (!token) {
          throw new Error("SESSION_EXPIRED");
        }

        const code = await reserveTrackingCode();
        console.log("[ShipWizard] Tracking code prepared", { code });

        let uploadedPhotoUrls: string[];
        try {
          uploadedPhotoUrls = await Promise.all(
            photos.map((photo, index) =>
              uploadShipmentPhotoBlob({
                code,
                index,
                blob: photo.blob,
                fallbackDataUrl: photo.fallbackDataUrl,
              })
            )
          );
        } catch (uploadErr) {
          throw new Error(
            uploadErr instanceof Error
              ? `Photo upload failed: ${uploadErr.message}`
              : "Could not upload item photos. Please try again."
          );
        }

        if (!uploadedPhotoUrls.length) {
          throw new Error("At least 1 uploaded item photo is required.");
        }
        console.log("[ShipWizard] Photos ready, calling /api/bookings", {
          count: uploadedPhotoUrls.length,
        });

        const res = await fetch("/api/bookings", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            code,
            idempotencyKey: attemptKey,
            embedded,
            senderId: uid,
            sender: {
              name: sName.trim(),
              email: sEmail.trim(),
              phone: sPhone.trim(),
              address: sAddr.trim(),
              city: sCity.trim(),
              postal: sPostal.trim(),
              country: sCountry,
            },
            receiver: {
              name: rName.trim(),
              email: rEmail.trim(),
              phone: rPhone.trim(),
              address: rAddr.trim(),
              city: rCity.trim(),
              postal: rPostal.trim(),
              country: rCountry,
            },
            weightKg: Number(pKg) || 0.1,
            lengthCm: Number(pL) || 0,
            widthCm: Number(pW) || 0,
            heightCm: Number(pH) || 0,
            packageType: pType,
            contents: pDesc.trim(),
            declaredValue: declaredNum,
            service,
            paymentMethod,
            photos: uploadedPhotoUrls,
          }),
        });

        const data = await res.json().catch(() => ({}));
        console.log("[ShipWizard] /api/bookings response", {
          status: res.status,
          ok: res.ok,
          awaitingPayment: data?.awaitingPayment,
          paymentChannel: data?.paymentChannel,
        });

        if (res.status === 401) {
          throw new Error("SESSION_EXPIRED");
        }
        if (!res.ok) {
          throw new Error(data.error || "Could not create booking.");
        }

        return { code, data };
      };

      const { code, data } = await Promise.race([
        runBookingSteps(),
        timeoutPromise,
      ]);

      if (data.paymentChannel === "pay_on_pickup" || !data.awaitingPayment) {
        const bundled: ShipmentRecord | undefined = data.shipment
          ? (data.shipment as ShipmentRecord)
          : undefined;
        await finishBookingSuccess(
          data.trackingCode || code,
          "Booked, payment due at pickup",
          bundled
        );
        return;
      }

      if (!data.checkoutUrl || !data.bookingId) {
        throw new Error("Checkout URL was not returned by the server.");
      }

      const bookingId = String(data.bookingId);
      const trackingCode = String(data.trackingCode || code);
      const checkoutUrl = String(data.checkoutUrl);

      setConfirmingPayment({
        bookingId,
        trackingCode,
        totalUsd: Number(data.totalUsd || activeQuote.total),
        checkoutUrl,
        overlayOpened: true,
        statusMessage: "Complete payment in the secure Bachs window…",
      });

      attachBookingListeners(bookingId, trackingCode);

      console.log("[ShipWizard] Opening Bachs checkout", { trackingCode });
      let completedEventSeen = false;
      await openBachsOverlay(
        checkoutUrl,
        (evType) => {
          if (evType === "checkout.completed") {
            completedEventSeen = true;
            setConfirmingPayment((prev) =>
              prev
                ? {
                    ...prev,
                    statusMessage:
                      "Confirming your payment… Waiting for Bachs webhook verification.",
                  }
                : prev
            );
          } else if (evType === "checkout.failed" || evType === "checkout.error") {
            cleanupBookingListeners();
            setConfirmingPayment(null);
            setSubmitError(
              "Payment was not completed. Please check your details and try again."
            );
          } else if (evType === "checkout.closed") {
            if (completedEventSeen) return;
            window.setTimeout(() => {
              setConfirmingPayment((prev) => {
                if (!prev) return prev;
                cleanupBookingListeners();
                setCancelNotice(
                  "Payment not completed — your details are preserved."
                );
                return null;
              });
            }, 1500);
          }
        },
        (_url, reason) => {
          setConfirmingPayment((prev) =>
            prev
              ? {
                  ...prev,
                  overlayOpened: false,
                  fallbackNotice: reason,
                  statusMessage:
                    "Complete payment in the Bachs checkout tab below, then return here while webhook confirms.",
                }
              : prev
          );
        }
      );
    } catch (err) {
      console.error("[ShipWizard] Booking failed:", err);
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.message === "BOOKING_TIMEOUT")
      ) {
        const timeoutMsg =
          "Booking request timed out after 30 seconds. Please check your connection and try again.";
        setSubmitError(timeoutMsg);
        toast.error(timeoutMsg);
      } else if (err instanceof Error && err.message === "SESSION_EXPIRED") {
        openAuth({
          mode: "login",
          prompt: "Your session expired. Sign in again to confirm your booking.",
          onDone: async (authedUser) => {
            const fresh = await authedUser.getIdToken(true).catch(() => "");
            submitLockRef.current = false;
            await executeBooking(authedUser.uid, fresh);
          },
        });
      } else {
        const msg =
          err instanceof Error ? err.message : "Could not complete booking.";
        setSubmitError(msg);
        toast.error(msg);
      }
    } finally {
      if (timerHandle !== undefined) window.clearTimeout(timerHandle);
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!allPreviousValid) {
      const firstS1 = Object.keys(step1Issues)[0];
      if (firstS1) {
        setErrors(step1Issues);
        setStep(1);
        focusField(firstS1);
        toast.error("Complete Step 1 address & phone details first.");
        return;
      }
      const firstS2 = Object.keys(step2Issues)[0];
      if (firstS2) {
        setErrors(step2Issues);
        setStep(2);
        focusField(firstS2);
        toast.error("Complete Step 2 package & photo details first.");
        return;
      }
    }

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
          const fresh = await authedUser.getIdToken(true).catch(() => "");
          await executeBooking(authedUser.uid, fresh);
        },
      });
      return;
    }
    await executeBooking(user.uid);
  };

  const handleResetWizard = () => {
    cleanupBookingListeners();
    clearDraft();
    setCompleted(null);
    setConfirmingPayment(null);
    setSubmitError("");
    setCancelNotice("");
    setStep(1);
    setPhotos([]);
    setPDesc("");
    setTermsAccepted(false);
  };

  const trackHref = (c: string) =>
    embedded ? `/dashboard/track/${c}` : `/track/${c}`;

  if (!authReady) {
    return (
      <div className={embedded ? "ship dx-embed" : "wrap"} style={embedded ? undefined : { paddingTop: 48, paddingBottom: 64 }}>
        <div className="dx-skel" style={{ height: 220, maxWidth: 640, margin: "0 auto" }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="panel" style={{ maxWidth: 560, margin: "0 auto" }}>
          <div className="panel-h">
            <div className="pi">
              <Lock className="w-[17px] h-[17px]" />
            </div>
            <div>
              <b>Account required to book</b>
              <small>Log in or create a free ShipWell account</small>
            </div>
          </div>
          <div className="panel-b">
            <p className="lead" style={{ marginBottom: 20 }}>
              Log in or create a free account to ship a parcel. Your tracking
              number and the receiver link are kept on your account.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="sw-btn sw-btn-em"
                onClick={() =>
                  openAuth({
                    mode: "login",
                    prompt:
                      "Log in or create a free account to ship a parcel. Your tracking number and the receiver link are kept on your account.",
                  })
                }
              >
                Log in
              </button>
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                onClick={() =>
                  openAuth({
                    mode: "signup",
                    prompt:
                      "Log in or create a free account to ship a parcel. Your tracking number and the receiver link are kept on your account.",
                  })
                }
              >
                Create free account
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (confirmingPayment) {
    return (
      <div className={embedded ? "ship dx-embed" : "wrap"}>
        <div className="done" style={{ maxWidth: 540 }}>
          <div className="tick">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
          <div className="eyebrow c">Awaiting confirmation</div>
          <h1
            className="bebas"
            style={{
              fontWeight: 400,
              fontSize: "clamp(2.2rem,8vw,3.4rem)",
              lineHeight: 0.95,
              marginBottom: 12,
            }}
          >
            CONFIRMING YOUR PAYMENT…
          </h1>
          <p className="lead">{confirmingPayment.statusMessage}</p>
          {confirmingPayment.fallbackNotice && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
              {confirmingPayment.fallbackNotice}
            </p>
          )}

          <div className="ticket" style={{ marginTop: 22 }}>
            <div className="tt">
              <small>Reserved tracking number</small>
              <div className="code">{confirmingPayment.trackingCode}</div>
              <small style={{ color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>
                Total {formatMoney(confirmingPayment.totalUsd)} · Parcel dispatches once webhook verifies settlement
              </small>
            </div>
          </div>

          <div className="acts" style={{ justifyContent: "center", marginTop: 18 }}>
            <a
              href={confirmingPayment.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="sw-btn sw-btn-em sw-btn-lg"
            >
              <CreditCard className="w-4 h-4" />
              Continue to payment
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {confirmingPayment.timedOut && (
              <Link
                className="sw-btn sw-btn-ghost sw-btn-lg"
                to={trackHref(confirmingPayment.trackingCode)}
              >
                Check tracking status →
              </Link>
            )}
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-lg"
              onClick={() => {
                cleanupBookingListeners();
                setConfirmingPayment(null);
                setCancelNotice(
                  "Payment not completed — your details are preserved."
                );
              }}
            >
              Back to checkout
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (completed) {
    const s = completed.shipment;
    return (
      <div className={embedded ? "ship dx-embed" : "wrap"}>
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
                <small>{completed.paymentStatusLabel}</small>
                <b>{formatMoney(s.priceTotal)}</b>
              </div>
            </div>
          </div>

          <div className="acts" style={{ justifyContent: "center" }}>
            <Link
              className="sw-btn sw-btn-em sw-btn-lg"
              to={trackHref(s.code)}
            >
              Track Shipment →
            </Link>
            <Link className="sw-btn sw-btn-ghost sw-btn-lg" to="/dashboard">
              My dashboard
            </Link>
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-lg"
              onClick={handleResetWizard}
            >
              Book another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const paymentChoices: {
    value: "Pay now" | "Pay on delivery";
    label: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    enabled: boolean;
  }[] = [
    {
      value: "Pay now",
      label: "Pay now",
      sub: "Instant digital settlement",
      icon: Zap,
      enabled: checkoutOptions.bachsEnabled,
    },
    {
      value: "Pay on delivery",
      label: "Pay on delivery",
      sub: "Settle when courier delivers",
      icon: Truck,
      enabled: checkoutOptions.payOnPickupEnabled,
    },
  ];

  return (
    <div className={embedded ? "ship dx-embed" : "wrap"}>
      {!embedded && (
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
      )}

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
                <button
                  key={item.n}
                  type="button"
                  className={`ps ${cls}`}
                  onClick={() => {
                    if (item.n < step) {
                      setStep(item.n);
                      return;
                    }
                    if (item.n === 2 && validateStep(1)) setStep(2);
                    else if (item.n === 3 && validateStep(1) && validateStep(2))
                      setStep(3);
                    else if (item.n === 4 && validateStep(1) && validateStep(2))
                      setStep(4);
                  }}
                >
                  <div className="pc">
                    {step > item.n ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <span>{item.n}</span>
                    )}
                  </div>
                  <small>{item.label}</small>
                </button>
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
                        placeholder="John Doe"
                      />
                      {errors.sName && (
                        <span className="ferr">{errors.sName}</span>
                      )}
                    </div>
                    <div className={`fw ${errors.sPhone ? "err" : ""}`}>
                      <PhoneField
                        id="sPhone"
                        label="Phone"
                        required
                        value={sPhone}
                        onChange={(val) => {
                          setSPhoneInput(val);
                          if (errors.sPhone) {
                            setErrors((p) => {
                              const n = { ...p };
                              delete n.sPhone;
                              return n;
                            });
                          }
                        }}
                        countryHint={sCountry}
                        hasError={Boolean(errors.sPhone)}
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
                      placeholder="john.doe@example.com"
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
                      placeholder="350 Fifth Avenue"
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
                        placeholder="New York"
                      />
                      {errors.sCity && (
                        <span className="ferr">{errors.sCity}</span>
                      )}
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
                        placeholder="10118"
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
                        placeholder="Jane Smith"
                      />
                      {errors.rName && (
                        <span className="ferr">{errors.rName}</span>
                      )}
                    </div>
                    <div className={`fw ${errors.rPhone ? "err" : ""}`}>
                      <PhoneField
                        id="rPhone"
                        label="Phone"
                        required
                        value={rPhone}
                        onChange={(val) => {
                          setRPhone(val);
                          if (errors.rPhone) {
                            setErrors((p) => {
                              const n = { ...p };
                              delete n.rPhone;
                              return n;
                            });
                          }
                        }}
                        countryHint={rCountry}
                        hasError={Boolean(errors.rPhone)}
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
                      placeholder="jane.smith@example.com"
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
                      placeholder="221B Baker Street"
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
                      {errors.rCity && (
                        <span className="ferr">{errors.rCity}</span>
                      )}
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
                        placeholder="NW1 6XE"
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
                      id="photos"
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
                            <img
                              src={item.previewUrl}
                              alt={`Uploaded item ${idx + 1}`}
                            />
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
                      placeholder="e.g. Laptop, 2× linen shirts"
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
                              {meta.blurb} · {q.days[0]}–{q.days[1]} business
                              days (by {estDate})
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
              {cancelNotice && (
                <div className="tk-hold a" style={{ marginBottom: 14, borderRadius: 14, border: "1px solid rgba(245, 158, 11, 0.35)" }}>
                  <AlertCircle className="w-5 h-5 hi shrink-0" />
                  <div>
                    <b>Payment notice</b>
                    <small>{cancelNotice}</small>
                  </div>
                </div>
              )}

              {!allPreviousValid && (
                <div className="tk-hold r" style={{ marginBottom: 14, borderRadius: 14, border: "1px solid rgba(244, 63, 94, 0.35)" }}>
                  <AlertCircle className="w-5 h-5 hi shrink-0" />
                  <div style={{ flex: 1 }}>
                    <b>Details needed before confirmation</b>
                    <small style={{ display: "block", marginBottom: 8 }}>
                      Tap an item below to jump straight to the missing field:
                    </small>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(step1Issues).map(([fieldKey, msg]) => (
                        <button
                          key={fieldKey}
                          type="button"
                          className="sw-btn sw-btn-ghost"
                          style={{ padding: "5px 10px", fontSize: 12 }}
                          onClick={() => {
                            setErrors(step1Issues);
                            setStep(1);
                            focusField(fieldKey);
                          }}
                        >
                          Step 1: {msg}
                        </button>
                      ))}
                      {Object.entries(step2Issues).map(([fieldKey, msg]) => (
                        <button
                          key={fieldKey}
                          type="button"
                          className="sw-btn sw-btn-ghost"
                          style={{ padding: "5px 10px", fontSize: 12 }}
                          onClick={() => {
                            setErrors(step2Issues);
                            setStep(2);
                            focusField(fieldKey);
                          }}
                        >
                          Step 2: {msg}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

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
                    <div className="r">
                      <span>Total due</span>
                      <b style={{ color: "var(--em)" }}>
                        {formatMoney(activeQuote.total)}
                      </b>
                    </div>
                    <hr />
                    <div className="r">
                      <span>Item photos ({photos.length})</span>
                      <div className="flex gap-2 justify-end flex-wrap">
                        {photos.map((item, i) => (
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
                    {paymentChoices.map((pm) => {
                      const Icon = pm.icon;
                      return (
                        <label
                          key={pm.value}
                          style={{
                            opacity: pm.enabled ? 1 : 0.45,
                            cursor: pm.enabled ? "pointer" : "not-allowed",
                          }}
                        >
                          <input
                            type="radio"
                            name="pay"
                            value={pm.value}
                            disabled={!pm.enabled}
                            checked={paymentMethod === pm.value}
                            onChange={() => {
                              if (pm.enabled) setPaymentMethod(pm.value);
                            }}
                          />
                          <span>
                            <Icon className="w-5 h-5" />
                            <b>{pm.label}</b>
                            <small style={{ fontSize: 11, fontWeight: 400 }}>
                              {pm.enabled ? pm.sub : "Unavailable right now"}
                            </small>
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
                        onChange={(e) => {
                          setTermsAccepted(e.target.checked);
                          if (e.target.checked) {
                            setErrors((p) => {
                              const n = { ...p };
                              delete n.terms;
                              return n;
                            });
                          }
                        }}
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

                  {submitError && (
                    <div className="au-err" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <span>{submitError}</span>
                      <button
                        type="button"
                        className="sw-btn sw-btn-ghost"
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={handleConfirm}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Try again
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="acts">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  disabled={submitting}
                  onClick={() => setStep(3)}
                >
                  ← Back
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  disabled={submitting || !termsAccepted || !allPreviousValid}
                  onClick={handleConfirm}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {submitting
                    ? "Processing booking..."
                    : paymentMethod === "Pay on delivery"
                      ? "Confirm Booking"
                      : `Confirm & Pay ${formatMoney(activeQuote.total)}`}
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
              <small>Updates as you type · recalculated at checkout</small>
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
                Price verified on server. Import duties and taxes at destination
                may apply.
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
