import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import {
  AlertCircle,
  Boxes,
  Camera,
  Check,
  Coins,
  Copy,
  CreditCard,
  DollarSign,
  ExternalLink,
  FileText,
  Home as HomeIcon,
  Landmark,
  Loader2,
  Lock,
  Package,
  RefreshCw,
  Smartphone,
  Trash2,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { PhoneField } from "@/components/PhoneField";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
import { openBachsOverlay } from "@/lib/bachs-overlay";
import { apiFetch } from "@/lib/api-client";
import {
  clearGuestDraft,
  deleteUserDraft,
  listUserDrafts,
  makeDraftId,
  readGuestDraft,
  saveUserDraft,
  writeGuestDraft,
} from "@/lib/drafts";
import { formatUserFacingError, logClientError, StepError } from "@/lib/error-logger";
import { db } from "@/lib/firebase";
import {
  checkAccountExists,
  fetchFullShipmentBundleWithRetry,
  reserveTrackingCode,
} from "@/lib/firestore-shipments";
import {
  DEFAULT_PAYMENT_METHODS,
  calculateMethodAmounts,
  filterEligiblePaymentMethods,
} from "@/lib/payment-methods";
import { countryNameToIso2, validateInternationalPhone } from "@/lib/phone";
import {
  prepareShipmentPhoto,
  uploadDraftPhoto,
  uploadShipmentPhotoBlob,
} from "@/lib/storage";
import {
  addBusinessDays,
  calculateMultiParcelPricing,
  COUNTRIES,
  formatMoney,
  formatShortDay,
  getDefaultOriginCountry,
  PLACES,
  SERVICES,
} from "@/lib/quote-engine";
import {
  formatParcelContentsSummary,
  formatTimeAgo,
  normalizeEmail,
  type BookingRecord,
  type DraftShipmentRecord,
  type DraftWizardData,
  type ManualPaymentRecord,
  type PaymentMethodRecord,
  type PaymentMethodType,
  type ServiceTier,
  type ShipmentRecord,
} from "@/types/tracking";
import toast from "react-hot-toast";

interface WizardPhoto {
  id: string;
  previewUrl: string;
  blob?: Blob;
  fallbackDataUrl?: string;
  uploadedUrl?: string;
  storagePath?: string;
  name?: string;
}

interface WizardParcel {
  id: string;
  expanded: boolean;
  kg: string;
  packageType: string;
  l: string;
  w: string;
  h: string;
  declaredValue: string;
  contents: string;
  photos: WizardPhoto[];
  dragOver?: boolean;
}

const MAX_PARCELS = 10;
const MAX_TOTAL_PHOTOS = 20;

function computeParcelBillableKg(p: Pick<WizardParcel, "kg" | "l" | "w" | "h">): number {
  const actual = Math.max(0.1, Number(p.kg) || 0.1);
  const vol =
    ((Math.max(0, Number(p.l) || 0) *
      Math.max(0, Number(p.w) || 0) *
      Math.max(0, Number(p.h) || 0)) /
      5000) ||
    0;
  return Math.round(Math.max(actual, vol) * 100) / 100;
}

function makeDefaultParcel(
  idx: number,
  overrides: Partial<WizardParcel> = {}
): WizardParcel {
  return {
    id: overrides.id || (idx === 0 ? "parcel_1" : `parcel_${idx + 1}_${Date.now().toString(36).slice(-4)}`),
    expanded: overrides.expanded ?? true,
    kg: overrides.kg ?? "1.5",
    packageType: overrides.packageType ?? "Parcel",
    l: overrides.l ?? "30",
    w: overrides.w ?? "20",
    h: overrides.h ?? "15",
    declaredValue: overrides.declaredValue ?? "250",
    contents: overrides.contents ?? "",
    photos: overrides.photos ?? [],
    dragOver: false,
  };
}

function getMethodIcon(type: PaymentMethodType): React.ComponentType<{ className?: string }> {
  switch (type) {
    case "automatic":
      return Zap;
    case "bank_transfer":
      return Landmark;
    case "crypto":
      return Coins;
    case "mobile_money":
      return Smartphone;
    case "cash":
      return Truck;
    default:
      return CreditCard;
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

/** Resolve with `fallback` if `p` is slow or fails, so background steps can never freeze the booking screen. */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

export function ShipWizard({
  embedded = false,
  draftIdParam,
}: {
  embedded?: boolean;
  draftIdParam?: string | null;
}) {
  const [searchParams] = useSearchParams();
  const { user, profile, authReady, openAuth, openContact, refreshOpenAlerts } =
    useShipWell();
  const promptedRef = useRef(false);
  const submitLockRef = useRef(false);
  const unsubBookingRef = useRef<(() => void) | null>(null);
  const appliedDraftRef = useRef<string | null>(null);

  const qFrom = searchParams.get("from");
  const qTo = searchParams.get("to");
  const qKg = searchParams.get("kg");
  const qVal = searchParams.get("val");
  const qSvc = searchParams.get("svc") as ServiceTier | null;
  const qDraft = draftIdParam ?? searchParams.get("draft");
  const cancelledQuery = searchParams.get("cancelled") === "1";

  const initialGuestDraft = useMemo(() => readGuestDraft(), []);
  const [activeDraftId, setActiveDraftId] = useState<string>(
    () => qDraft || initialGuestDraft?.id || makeDraftId()
  );
  const [draftCreatedAtMs, setDraftCreatedAtMs] = useState<number>(
    () => initialGuestDraft?.updatedAtMs || Date.now()
  );
  const [resumePromptDraft, setResumePromptDraft] =
    useState<DraftShipmentRecord | null>(null);
  const [draftSaveLabel, setDraftSaveLabel] = useState("");

  const fallbackOrigin = useMemo(() => getDefaultOriginCountry(), []);
  const fallbackDest =
    fallbackOrigin === "United Kingdom" ? "United States" : "United Kingdom";

  const gd = initialGuestDraft?.data;
  const initSCountry =
    qFrom && PLACES[qFrom]
      ? qFrom
      : gd?.sCountry && PLACES[gd.sCountry]
        ? gd.sCountry
        : fallbackOrigin;
  const initRCountry =
    qTo && PLACES[qTo]
      ? qTo
      : gd?.rCountry && PLACES[gd.rCountry]
        ? gd.rCountry
        : initSCountry === "United Kingdom"
          ? "United States"
          : fallbackDest;

  const [step, setStep] = useState<number>(() => {
    if (cancelledQuery) return 4;
    if (initialGuestDraft?.step && initialGuestDraft.step >= 1 && initialGuestDraft.step <= 4) {
      return initialGuestDraft.step;
    }
    return 1;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    title: string;
    details: string;
  } | null>(null);
  const [cancelNotice, setCancelNotice] = useState(
    cancelledQuery
      ? "Payment not completed — your details are preserved."
      : ""
  );

  // Step 1
  const [sNameInput, setSNameInput] = useState<string | null>(
    gd?.sName ? gd.sName : null
  );
  const [sPhoneInput, setSPhoneInput] = useState<string | null>(
    gd?.sPhone ? gd.sPhone : null
  );
  const [sEmailInput, setSEmailInput] = useState<string | null>(
    gd?.sEmail ? gd.sEmail : null
  );
  const sName = sNameInput ?? (profile?.name || user?.displayName || "");
  const sPhone = sPhoneInput ?? (profile?.phone || "");
  const sEmail = sEmailInput ?? (profile?.email || user?.email || "");

  const [sAddr, setSAddr] = useState(gd?.sAddr || "");
  const [sCity, setSCity] = useState(
    gd?.sCity && !qFrom ? gd.sCity : PLACES[initSCountry].city
  );
  const [sPostal, setSPostal] = useState(gd?.sPost || "");
  const [sCountry, setSCountry] = useState(initSCountry);

  const [rName, setRName] = useState(gd?.rName || "");
  const [rPhone, setRPhone] = useState(gd?.rPhone || "");
  const [rEmail, setREmail] = useState(gd?.rEmail || "");
  const [rAddr, setRAddr] = useState(gd?.rAddr || "");
  const [rCity, setRCity] = useState(
    gd?.rCity && !qTo ? gd.rCity : PLACES[initRCountry].city
  );
  const [rPostal, setRPostal] = useState(gd?.rPost || "");
  const [rCountry, setRCountry] = useState(initRCountry);

  // Step 2: 1..10 parcels
  const [parcels, setParcels] = useState<WizardParcel[]>(() => {
    if (Array.isArray(gd?.parcels) && gd.parcels.length > 0) {
      return gd.parcels.slice(0, MAX_PARCELS).map((dp, idx) =>
        makeDefaultParcel(idx, {
          id: dp.id || `parcel_${idx + 1}`,
          expanded: idx === 0,
          kg: dp.weight || "1.5",
          packageType: dp.pkgType || "Parcel",
          l: dp.lengthCm || "30",
          w: dp.widthCm || "20",
          h: dp.heightCm || "15",
          declaredValue: dp.val ?? "250",
          contents: dp.contents || "",
          photos: (dp.photos || []).map((p, pIdx) => ({
            id: `restored_${idx}_${pIdx}`,
            previewUrl: p.url,
            uploadedUrl: p.url,
            storagePath: p.storagePath,
            name: p.name,
          })),
        })
      );
    }
    return [
      makeDefaultParcel(0, {
        id: "parcel_1",
        expanded: true,
        kg: qKg || gd?.weight || "1.5",
        packageType: gd?.pkgType || "Parcel",
        declaredValue: qVal || gd?.val || "250",
        contents: gd?.contents || "",
        photos: (gd?.photos || []).map((p, idx) => ({
          id: `restored_${idx}`,
          previewUrl: p.url,
          uploadedUrl: p.url,
          storagePath: p.storagePath,
          name: p.name,
        })),
      }),
    ];
  });

  // Step 3 & 4
  const [service, setService] = useState<ServiceTier>(
    qSvc && SERVICES[qSvc]
      ? qSvc
      : gd?.service && SERVICES[gd.service]
        ? gd.service
        : "standard"
  );
  const [allMethods, setAllMethods] = useState<PaymentMethodRecord[]>(
    DEFAULT_PAYMENT_METHODS
  );
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState<string>(
    gd?.paymentMethodId || ""
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [receiverExists, setReceiverExists] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Live automatic checkout overlay state
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

  // Manual payment completion state (Bank transfer / Crypto / Mobile money / Other)
  const [manualPaymentState, setManualPaymentState] = useState<{
    shipment: ShipmentRecord;
    payment: ManualPaymentRecord;
  } | null>(null);

  // Completed state (Cash / Paid automatic)
  const [completed, setCompleted] = useState<{
    shipment: ShipmentRecord;
    receiverHasAccount: boolean;
    paymentStatusLabel: string;
  } | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const applyDraftRecord = useCallback((rec: DraftShipmentRecord) => {
    const d = rec.data;
    setActiveDraftId(rec.id);
    setDraftCreatedAtMs(rec.createdAtMs || Date.now());
    if (d.sName) setSNameInput(d.sName);
    if (d.sPhone) setSPhoneInput(d.sPhone);
    if (d.sEmail) setSEmailInput(d.sEmail);
    setSAddr(d.sAddr || "");
    if (d.sCountry && PLACES[d.sCountry]) setSCountry(d.sCountry);
    setSCity(d.sCity || PLACES[d.sCountry]?.city || "");
    setSPostal(d.sPost || "");
    setRName(d.rName || "");
    setRPhone(d.rPhone || "");
    setREmail(d.rEmail || "");
    setRAddr(d.rAddr || "");
    if (d.rCountry && PLACES[d.rCountry]) setRCountry(d.rCountry);
    setRCity(d.rCity || PLACES[d.rCountry]?.city || "");
    setRPostal(d.rPost || "");
    if (Array.isArray(d.parcels) && d.parcels.length > 0) {
      setParcels(
        d.parcels.slice(0, MAX_PARCELS).map((dp, idx) =>
          makeDefaultParcel(idx, {
            id: dp.id || `parcel_${idx + 1}`,
            expanded: idx === 0,
            kg: dp.weight || "1.5",
            packageType: dp.pkgType || "Parcel",
            l: dp.lengthCm || "30",
            w: dp.widthCm || "20",
            h: dp.heightCm || "15",
            declaredValue: dp.val ?? "250",
            contents: dp.contents || "",
            photos: (dp.photos || []).map((p, pIdx) => ({
              id: `draft_${idx}_${pIdx}_${Date.now()}`,
              previewUrl: p.url,
              uploadedUrl: p.url,
              storagePath: p.storagePath,
              name: p.name,
            })),
          })
        )
      );
    } else {
      setParcels([
        makeDefaultParcel(0, {
          id: "parcel_1",
          expanded: true,
          kg: d.weight || "1.5",
          packageType: d.pkgType || "Parcel",
          declaredValue: d.val || "250",
          contents: d.contents || "",
          photos: Array.isArray(d.photos)
            ? d.photos.map((p, idx) => ({
                id: `draft_${idx}_${Date.now()}`,
                previewUrl: p.url,
                uploadedUrl: p.url,
                storagePath: p.storagePath,
                name: p.name,
              }))
            : [],
        }),
      ]);
    }
    if (d.service && SERVICES[d.service]) setService(d.service);
    if (d.paymentMethodId) setSelectedMethodId(d.paymentMethodId);
    setStep(Math.min(4, Math.max(1, Number(rec.step || 1))));
    setResumePromptDraft(null);
  }, []);

  // Load user's saved Firestore drafts when signed in
  useEffect(() => {
    if (!authReady || !user) return;
    let active = true;
    listUserDrafts(user.uid).then((drafts) => {
      if (!active || drafts.length === 0) return;
      if (qDraft) {
        const target = drafts.find((d) => d.id === qDraft);
        if (target && appliedDraftRef.current !== target.id) {
          appliedDraftRef.current = target.id;
          applyDraftRecord(target);
          toast.success("Draft restored");
        }
        return;
      }
      // Offer resume banner if user didn't pass quote params and hasn't typed yet
      const newest = drafts[0];
      const hasQuery = Boolean(qFrom || qTo || qKg || qVal);
      const hasAnyContents = parcels.some((p) => Boolean(p.contents.trim()));
      if (
        !hasQuery &&
        newest.id !== activeDraftId &&
        appliedDraftRef.current !== newest.id &&
        !rName.trim() &&
        !hasAnyContents
      ) {
        setResumePromptDraft(newest);
      }
    });
    return () => {
      active = false;
    };
  }, [authReady, user, qDraft, qFrom, qTo, qKg, qVal, activeDraftId, rName, parcels, applyDraftRecord]);

  // Build serializable draft snapshot
  const buildDraftData = useCallback((): DraftWizardData => {
    const cleanParcels = parcels.slice(0, MAX_PARCELS).map((parcel) => ({
      id: parcel.id,
      weight: parcel.kg,
      pkgType: parcel.packageType,
      lengthCm: parcel.l,
      widthCm: parcel.w,
      heightCm: parcel.h,
      val: parcel.declaredValue,
      contents: parcel.contents,
      photos: parcel.photos
        .filter((p) => Boolean(p.uploadedUrl || p.fallbackDataUrl))
        .map((p) => ({
          url: p.uploadedUrl || p.fallbackDataUrl || "",
          ...(p.storagePath ? { storagePath: p.storagePath } : {}),
          ...(p.name ? { name: p.name } : {}),
        }))
        .filter((p) => p.url && !p.url.startsWith("blob:")),
    }));

    const totalWeight = parcels.reduce(
      (sum, p) => sum + computeParcelBillableKg(p),
      0
    );
    const totalVal = parcels.reduce(
      (sum, p) => sum + Math.max(0, Number(p.declaredValue) || 0),
      0
    );
    const aggPhotos = cleanParcels
      .map((p) => p.photos[0])
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 4);

    return {
      sName,
      sEmail,
      sPhone,
      sAddr,
      sCity,
      sPost: sPostal,
      sCountry,
      rName,
      rEmail,
      rPhone,
      rAddr,
      rCity,
      rPost: rPostal,
      rCountry,
      weight: String(Math.round(totalWeight * 100) / 100),
      pkgType:
        parcels.length > 1
          ? "Multiple parcels"
          : parcels[0]?.packageType || "Parcel",
      val: String(Math.round(totalVal * 100) / 100),
      contents: formatParcelContentsSummary(parcels),
      service,
      ...(selectedMethodId ? { paymentMethodId: selectedMethodId } : {}),
      photos:
        parcels.length === 1
          ? cleanParcels[0]?.photos.slice(0, 4) || []
          : aggPhotos,
      parcels: cleanParcels,
    };
  }, [
    sName,
    sEmail,
    sPhone,
    sAddr,
    sCity,
    sPostal,
    sCountry,
    rName,
    rEmail,
    rPhone,
    rAddr,
    rCity,
    rPostal,
    rCountry,
    parcels,
    service,
    selectedMethodId,
  ]);

  const persistDraftNow = useCallback(async () => {
    if (completed || manualPaymentState || confirmingPayment) return;
    const data = buildDraftData();
    const hasMeaningfulInput =
      step > 1 ||
      parcels.length > 1 ||
      Boolean(rName.trim()) ||
      Boolean(rEmail.trim()) ||
      Boolean(rAddr.trim()) ||
      Boolean(sAddr.trim()) ||
      parcels.some((p) => Boolean(p.contents.trim()) || p.photos.length > 0);

    if (!hasMeaningfulInput) return;

    if (!user) {
      writeGuestDraft({ id: activeDraftId, step, data });
      return;
    }

    try {
      await saveUserDraft({
        uid: user.uid,
        email: user.email || sEmail,
        draftId: activeDraftId,
        step,
        data,
        createdAtMs: draftCreatedAtMs,
      });
      setDraftSaveLabel("Draft saved");
    } catch (err) {
      console.warn("[ShipWizard] Draft autosave failed:", err);
      setDraftSaveLabel("Draft not saved");
    }
  }, [
    completed,
    manualPaymentState,
    confirmingPayment,
    buildDraftData,
    step,
    parcels,
    rName,
    rEmail,
    rAddr,
    sAddr,
    user,
    activeDraftId,
    sEmail,
    draftCreatedAtMs,
  ]);

  // Debounced autosave + flush on unload
  useEffect(() => {
    const t = window.setTimeout(() => {
      persistDraftNow();
    }, 950);
    return () => window.clearTimeout(t);
  }, [persistDraftNow]);

  useEffect(() => {
    const onHide = () => {
      persistDraftNow();
    };
    window.addEventListener("beforeunload", onHide);
    return () => window.removeEventListener("beforeunload", onHide);
  }, [persistDraftNow]);

  // Multi-parcel pricing computation
  const pricingInputs = useMemo(
    () =>
      parcels.map((p, idx) => ({
        id: p.id,
        label: p.contents.trim() || `Parcel ${idx + 1}`,
        billableKg: computeParcelBillableKg(p),
        declaredValue: Math.max(0, Number(p.declaredValue) || 0),
      })),
    [parcels]
  );

  const allQuotes = useMemo(() => {
    return (["economy", "standard", "express"] as ServiceTier[]).map((tier) =>
      calculateMultiParcelPricing(sCountry, rCountry, pricingInputs, tier)
    );
  }, [sCountry, rCountry, pricingInputs]);

  const activeQuote =
    allQuotes.find((q) => q.service === service) || allQuotes[1];
  const chargeableKg = activeQuote.totalWeightKg;
  const declaredNum = activeQuote.totalDeclaredValue;
  const totalPhotosCount = useMemo(
    () => parcels.reduce((sum, p) => sum + p.photos.length, 0),
    [parcels]
  );

  // Fetch enabled dynamic payment methods from Admin settings
  useEffect(() => {
    let active = true;
    apiFetch<{ ok: boolean; methods: PaymentMethodRecord[] }>(
      `/api/payment-methods?appliesTo=shipping&amount=${encodeURIComponent(
        String(activeQuote.total)
      )}&country=${encodeURIComponent(rCountry)}`,
      { step: "load_payment_methods" }
    )
      .then((res) => {
        if (!active || !Array.isArray(res.methods)) return;
        setAllMethods(res.methods);
        setMethodsLoaded(true);
      })
      .catch(() => {
        if (active) {
          setAllMethods(
            filterEligiblePaymentMethods({
              methods: DEFAULT_PAYMENT_METHODS,
              appliesTo: "shipping",
              amountUsd: activeQuote.total,
              country: rCountry,
              isBusiness: Boolean(profile?.company),
            })
          );
          setMethodsLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [activeQuote.total, rCountry, profile?.company]);

  const eligibleMethods = useMemo(() => {
    return filterEligiblePaymentMethods({
      methods: allMethods,
      appliesTo: "shipping",
      amountUsd: activeQuote.total,
      country: rCountry,
      isBusiness: Boolean(profile?.company),
    });
  }, [allMethods, activeQuote.total, rCountry, profile?.company]);

  const selectedMethod = useMemo(() => {
    if (eligibleMethods.length === 0) return null;
    return (
      eligibleMethods.find((m) => m.id === selectedMethodId) ||
      eligibleMethods[0]
    );
  }, [eligibleMethods, selectedMethodId]);

  const activeAmounts = useMemo(() => {
    if (!selectedMethod) {
      return {
        baseUsd: activeQuote.total,
        feeAmountUsd: 0,
        totalUsd: activeQuote.total,
        currency: "USD",
        exchangeRate: 1,
        convertedAmount: activeQuote.total,
      };
    }
    return calculateMethodAmounts(activeQuote.total, selectedMethod);
  }, [activeQuote.total, selectedMethod]);

  // Check receiver account existence when entering Step 4
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

  const cleanupBookingListeners = useCallback(() => {
    unsubBookingRef.current?.();
    unsubBookingRef.current = null;
  }, []);

  useEffect(() => {
    return () => cleanupBookingListeners();
  }, [cleanupBookingListeners]);

  const updateParcel = useCallback(
    (parcelId: string, updater: (prev: WizardParcel) => WizardParcel) => {
      setParcels((prev) => prev.map((p) => (p.id === parcelId ? updater(p) : p)));
    },
    []
  );

  const handlePhotoFiles = async (parcelIdx: number, fileList: FileList | null) => {
    if (!fileList?.length) return;
    const targetParcel = parcels[parcelIdx];
    if (!targetParcel) return;

    const parcelSlots = 4 - targetParcel.photos.length;
    if (parcelSlots <= 0) {
      toast("Maximum 4 photos allowed per parcel.");
      return;
    }
    const bookingSlots = MAX_TOTAL_PHOTOS - totalPhotosCount;
    if (bookingSlots <= 0) {
      toast(`Maximum ${MAX_TOTAL_PHOTOS} photos allowed per booking.`);
      return;
    }

    const chosen = Array.from(fileList).slice(0, Math.min(parcelSlots, bookingSlots));
    try {
      const preparedItems = await Promise.all(
        chosen.map(async (file, idx) => {
          const p = await prepareShipmentPhoto(file);
          let uploaded:
            | { url: string; storagePath: string; name: string }
            | undefined;
          if (user) {
            uploaded = await uploadDraftPhoto({
              uid: user.uid,
              draftId: activeDraftId,
              file,
            }).catch(() => undefined);
          }
          return {
            id: `ph_${Date.now()}_${parcelIdx}_${idx}`,
            previewUrl: uploaded?.url || p.previewUrl,
            blob: p.blob,
            fallbackDataUrl: p.fallbackDataUrl,
            uploadedUrl: uploaded?.url,
            storagePath: uploaded?.storagePath,
            name: file.name,
          } as WizardPhoto;
        })
      );
      updateParcel(targetParcel.id, (cur) => ({
        ...cur,
        photos: [...cur.photos, ...preparedItems].slice(0, 4),
      }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[`parcel_${parcelIdx}_photos`];
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
    parcels.forEach((p, idx) => {
      const prefix = parcels.length > 1 ? `Parcel ${idx + 1}: ` : "";
      const actual = Number(p.kg);
      const billable = computeParcelBillableKg(p);
      if (!Number.isFinite(actual) || actual < 0.1 || billable > 50000) {
        e[`parcel_${idx}_kg`] = `${prefix}Enter weight between 0.1 and 50,000 kg`;
      }
      if (p.photos.length === 0) {
        e[`parcel_${idx}_photos`] = `${prefix}Upload at least 1 item photo (1–4)`;
      }
      if (!p.contents.trim()) {
        e[`parcel_${idx}_contents`] = `${prefix}Describe parcel contents`;
      }
      if (
        p.declaredValue === "" ||
        !Number.isFinite(Number(p.declaredValue)) ||
        Number(p.declaredValue) < 0
      ) {
        e[`parcel_${idx}_val`] = `${prefix}Enter declared value`;
      }
    });
    return e;
  }, [parcels]);

  const step1Issues = useMemo(() => getStep1Errors(), [getStep1Errors]);
  const step2Issues = useMemo(() => getStep2Errors(), [getStep2Errors]);
  const allPreviousValid =
    Object.keys(step1Issues).length === 0 &&
    Object.keys(step2Issues).length === 0;

  const expandParcelForFieldKey = useCallback((fieldKey: string) => {
    const match = /^parcel_(\d+)_/.exec(fieldKey);
    if (!match) return;
    const idx = Number(match[1]);
    setParcels((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, expanded: true } : p))
    );
  }, []);

  const validateStep = (targetStep: number): boolean => {
    const e = targetStep === 1 ? getStep1Errors() : getStep2Errors();
    setErrors(e);
    const keys = Object.keys(e);
    if (keys.length > 0) {
      if (targetStep === 2) expandParcelForFieldKey(keys[0]);
      toast.error("Please fix the highlighted fields.");
      focusField(keys[0]);
      return false;
    }
    return true;
  };

  const cleanupDraftAfterBooking = useCallback(
    async (uid: string) => {
      parcels.forEach((parcel) => {
        parcel.photos.forEach((p) => {
          if (p.previewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(p.previewUrl);
          }
        });
      });
      clearGuestDraft();
      await deleteUserDraft(uid, activeDraftId).catch(() => null);
    },
    [parcels, activeDraftId]
  );

  const finishBookingSuccess = useCallback(
    async (
      trackingCode: string,
      paymentStatusLabel: string,
      fallbackShipment?: ShipmentRecord,
      uidOverride?: string
    ) => {
      cleanupBookingListeners();
      let liveShipment = fallbackShipment || null;
      if (!liveShipment) {
        liveShipment = await withDeadline(
          fetchFullShipmentBundleWithRetry(trackingCode, 2),
          6000,
          null
        );
      } else {
        // Refresh in background without blocking the success screen
        fetchFullShipmentBundleWithRetry(trackingCode, 2).catch(() => null);
      }

      if (!liveShipment) {
        // Guaranteed local fallback so success screen NEVER fails after booking creation
        const fallbackParcels = parcels.map((p, idx) => ({
          id: p.id || `parcel_${idx + 1}`,
          contents: p.contents.trim() || `Parcel ${idx + 1}`,
          packageType: p.packageType || "Parcel",
          weightKg: computeParcelBillableKg(p),
          actualKg: Math.max(0.1, Number(p.kg) || 0.1),
          declaredValue: Math.max(0, Number(p.declaredValue) || 0),
          photos: [],
          review: { state: "pending" as const, note: "" },
        }));
        liveShipment = {
          code: trackingCode,
          senderId: uidOverride || user?.uid || "",
          senderEmail: normalizeEmail(sEmail),
          receiverEmail: normalizeEmail(rEmail),
          sender: {
            name: sName.trim(),
            email: normalizeEmail(sEmail),
            phone: sPhone.trim(),
            address: sAddr.trim(),
            city: sCity.trim(),
            postal: sPostal.trim(),
            country: sCountry,
          },
          receiver: {
            name: rName.trim(),
            email: normalizeEmail(rEmail),
            phone: rPhone.trim(),
            address: rAddr.trim(),
            city: rCity.trim(),
            postal: rPostal.trim(),
            country: rCountry,
          },
          service,
          weightKg: Number(chargeableKg.toFixed(2)),
          packageType:
            parcels.length > 1
              ? "Multiple parcels"
              : parcels[0]?.packageType || "Parcel",
          contents: formatParcelContentsSummary(parcels),
          declaredValue: declaredNum,
          parcels: fallbackParcels,
          priceTotal: activeAmounts.totalUsd,
          paymentMethod: selectedMethod?.name || "Pay on delivery",
          status: "Booked",
          eta: addBusinessDays(new Date(), activeQuote.days[1] + 1).getTime(),
          photos: [],
          review: { state: "pending", note: "", at: null, by: null },
        };
      }

      const recHasAccount = await withDeadline(
        checkAccountExists(liveShipment.receiverEmail),
        3000,
        false
      );
      const effectiveUid = uidOverride || user?.uid || liveShipment.senderId;
      setConfirmingPayment(null);
      setCompleted({
        shipment: liveShipment,
        receiverHasAccount: recHasAccount,
        paymentStatusLabel,
      });
      // Housekeeping runs in the background; it can never block the success screen
      if (effectiveUid) {
        void withDeadline(cleanupDraftAfterBooking(effectiveUid), 5000, undefined);
      }
      void withDeadline(refreshOpenAlerts(), 5000, undefined);
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success(`Shipment ${liveShipment.code} booked!`);
    },
    [
      cleanupBookingListeners,
      cleanupDraftAfterBooking,
      refreshOpenAlerts,
      user?.uid,
      sEmail,
      rEmail,
      sName,
      sPhone,
      sAddr,
      sCity,
      sPostal,
      sCountry,
      rName,
      rPhone,
      rAddr,
      rCity,
      rPostal,
      rCountry,
      service,
      chargeableKg,
      parcels,
      declaredNum,
      activeAmounts.totalUsd,
      selectedMethod?.name,
      activeQuote.days,
    ]
  );

  const attachBookingListeners = useCallback(
    (
      bookingId: string,
      trackingCode: string,
      fallbackShipment?: ShipmentRecord,
      uidOverride?: string
    ) => {
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
            finishBookingSuccess(
              trackingCode,
              "Paid",
              fallbackShipment,
              uidOverride
            ).catch(() => undefined);
          } else if (
            b.paymentStatus === "failed" ||
            b.paymentStatus === "expired" ||
            b.bookingStatus === "cancelled" ||
            b.bookingStatus === "expired"
          ) {
            window.clearTimeout(timeoutHandle);
            cleanupBookingListeners();
            setConfirmingPayment(null);
            setSubmitError({
              title:
                "Payment was not completed. Your details are preserved — please try again.",
              details: `Details: step=payment_webhook, code=${(b.paymentStatus || "FAILED").toUpperCase()}`,
            });
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

  const executeBooking = async (uid: string, freshIdToken?: string) => {
    if (submitLockRef.current) return;
    if (!selectedMethod) {
      setSubmitError({
        title: "No payment method is available for this route or order amount.",
        details: "Details: step=select_payment_method, code=NO_PAYMENT_METHOD",
      });
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setCancelNotice("");

    const attemptKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `bk_${crypto.randomUUID()}`
        : `bk_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

    let timerHandle: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerHandle = window.setTimeout(() => {
        reject(
          new StepError(
            "booking_timeout",
            "TIMEOUT",
            "Booking request timed out after 30 seconds. Please check your connection and try again."
          )
        );
      }, 30000);
    });

    try {
      const runBookingSteps = async () => {
        const token =
          freshIdToken || (await user?.getIdToken().catch(() => null)) || "";
        if (!token) {
          throw new StepError(
            "auth_token",
            "UNAUTHENTICATED",
            "Your session expired. Sign in again to confirm your booking."
          );
        }

        const code = await reserveTrackingCode();

        let globalPhotoIndex = 0;
        let uploadedParcelsPayload: Array<{
          id: string;
          contents: string;
          packageType: string;
          weightKg: number;
          lengthCm: number;
          widthCm: number;
          heightCm: number;
          declaredValue: number;
          photos: string[];
        }>;

        try {
          uploadedParcelsPayload = await Promise.all(
            parcels.map(async (parcel) => {
              const startIdx = globalPhotoIndex;
              globalPhotoIndex += parcel.photos.length;
              const urls = await Promise.all(
                parcel.photos.map(async (photo, pIdx) => {
                  if (photo.uploadedUrl && !photo.uploadedUrl.startsWith("blob:")) {
                    return photo.uploadedUrl;
                  }
                  if (photo.blob) {
                    return await uploadShipmentPhotoBlob({
                      code,
                      index: startIdx + pIdx,
                      blob: photo.blob,
                      fallbackDataUrl: photo.fallbackDataUrl,
                    });
                  }
                  if (photo.fallbackDataUrl) return photo.fallbackDataUrl;
                  throw new Error("Missing photo binary");
                })
              );
              return {
                id: parcel.id,
                contents: parcel.contents.trim(),
                packageType: parcel.packageType,
                weightKg: Number(parcel.kg) || 0.1,
                lengthCm: Number(parcel.l) || 0,
                widthCm: Number(parcel.w) || 0,
                heightCm: Number(parcel.h) || 0,
                declaredValue: Math.max(0, Number(parcel.declaredValue) || 0),
                photos: urls,
              };
            })
          );
        } catch (uploadErr) {
          throw new StepError(
            "upload_photos",
            "STORAGE_UPLOAD_FAILED",
            uploadErr instanceof Error
              ? `Photo upload failed: ${uploadErr.message}`
              : "Could not upload item photos. Please try again."
          );
        }

        if (uploadedParcelsPayload.some((p) => !p.photos.length)) {
          throw new StepError(
            "validate_photos",
            "MISSING_PHOTOS",
            "Each parcel requires at least 1 uploaded item photo."
          );
        }

        const aggregatePhotos = uploadedParcelsPayload
          .map((p) => p.photos[0])
          .filter(Boolean)
          .slice(0, 4);

        const data = await apiFetch<{
          ok: boolean;
          awaitingPayment: boolean;
          code: string;
          trackingCode: string;
          bookingId: string;
          status: string;
          totalUsd: number;
          paymentChannel: string;
          paymentStatus: string;
          checkoutUrl?: string | null;
          shipment?: ShipmentRecord;
          payment?: ManualPaymentRecord | null;
        }>("/api/bookings", {
          method: "POST",
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
            weightKg: chargeableKg,
            packageType:
              uploadedParcelsPayload.length > 1
                ? "Multiple parcels"
                : uploadedParcelsPayload[0]?.packageType || "Parcel",
            contents: formatParcelContentsSummary(uploadedParcelsPayload),
            declaredValue: declaredNum,
            parcels: uploadedParcelsPayload,
            service,
            paymentMethodId: selectedMethod.id,
            paymentMethod: selectedMethod.name,
            photos:
              uploadedParcelsPayload.length === 1
                ? uploadedParcelsPayload[0].photos.slice(0, 4)
                : aggregatePhotos,
          }),
          step: "createBooking",
          timeoutMs: 28000,
        });

        return { code: data.trackingCode || code, data };
      };

      const { code, data } = await Promise.race([
        runBookingSteps(),
        timeoutPromise,
      ]);

      // 1. Manual payment method (Bank transfer / Crypto / Mobile money / Other)
      if (data.payment) {
        await withDeadline(cleanupDraftAfterBooking(uid), 4000, undefined);
        await withDeadline(refreshOpenAlerts(), 3000, undefined);
        setManualPaymentState({
          shipment:
            data.shipment ||
            ({
              code,
              senderId: uid,
              senderEmail: normalizeEmail(sEmail),
              receiverEmail: normalizeEmail(rEmail),
              sender: {
                name: sName.trim(),
                email: normalizeEmail(sEmail),
                phone: sPhone.trim(),
                address: sAddr.trim(),
                city: sCity.trim(),
                postal: sPostal.trim(),
                country: sCountry,
              },
              receiver: {
                name: rName.trim(),
                email: normalizeEmail(rEmail),
                phone: rPhone.trim(),
                address: rAddr.trim(),
                city: rCity.trim(),
                postal: rPostal.trim(),
                country: rCountry,
              },
              service,
              weightKg: chargeableKg,
              packageType:
                parcels.length > 1
                  ? "Multiple parcels"
                  : parcels[0]?.packageType || "Parcel",
              contents: formatParcelContentsSummary(parcels),
              declaredValue: declaredNum,
              priceTotal: data.totalUsd,
              paymentMethod: selectedMethod.name,
              paymentStatus: "awaiting_payment",
              bookingStatus: "awaiting_payment",
              status: "Booked",
              eta: addBusinessDays(new Date(), activeQuote.days[1] + 1).getTime(),
              photos: [],
              review: { state: "pending", note: "", at: null, by: null },
            } as ShipmentRecord),
          payment: data.payment,
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast.success(
          `Booking ${code} created — follow payment instructions below.`
        );
        return;
      }

      // 2. Pay on delivery / cash (immediate confirmed ticket)
      if (!data.awaitingPayment) {
        await finishBookingSuccess(
          code,
          "Booked, payment due on delivery",
          data.shipment,
          uid
        );
        return;
      }

      // 3. Automatic gateway (Bachs / Stripe / Paystack)
      if (!data.checkoutUrl || !data.bookingId) {
        throw new StepError(
          "checkout_url",
          "MISSING_CHECKOUT_URL",
          "Checkout URL was not returned by the server."
        );
      }

      const bookingId = String(data.bookingId);
      const trackingCode = String(data.trackingCode || code);
      const checkoutUrl = String(data.checkoutUrl);

      setConfirmingPayment({
        bookingId,
        trackingCode,
        totalUsd: Number(data.totalUsd || activeAmounts.totalUsd),
        checkoutUrl,
        overlayOpened: true,
        statusMessage: `Complete payment in the secure ${selectedMethod.name} window…`,
      });

      attachBookingListeners(bookingId, trackingCode, data.shipment, uid);

      if (selectedMethod.gateway === "stripe" || selectedMethod.gateway === "paystack") {
        // Delete draft now so they can resume via Dashboard > Sent if they return without completing
        await withDeadline(cleanupDraftAfterBooking(uid), 4000, undefined);
        window.location.assign(checkoutUrl);
        return;
      }

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
            setSubmitError({
              title:
                "Payment was not completed. Please check your details and try again.",
              details: "Details: step=bachs_overlay, code=CHECKOUT_FAILED",
            });
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
                    "Complete payment in the checkout tab below, then return here while webhook confirms.",
                }
              : prev
          );
        }
      );
    } catch (err) {
      const formatted = formatUserFacingError(err, "createBooking");
      console.error("[ShipWizard] Booking failed:", {
        step: formatted.step,
        code: formatted.code,
        message: formatted.title,
        raw: err,
      });

      if (formatted.code === "UNAUTHENTICATED" || formatted.code === "HTTP_401") {
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
        logClientError({
          uid,
          step: formatted.step,
          code: formatted.code,
          message: formatted.title,
        });
        setSubmitError({
          title: formatted.title,
          details: formatted.details,
        });
        toast.error(formatted.title);
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
        expandParcelForFieldKey(firstS2);
        setErrors(step2Issues);
        setStep(2);
        focusField(firstS2);
        toast.error("Complete Step 2 package & photo details first.");
        return;
      }
    }

    if (!selectedMethod) {
      toast.error("No eligible payment method selected.");
      return;
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
    clearGuestDraft();
    setActiveDraftId(makeDraftId());
    setDraftCreatedAtMs(Date.now());
    setCompleted(null);
    setManualPaymentState(null);
    setConfirmingPayment(null);
    setSubmitError(null);
    setCancelNotice("");
    setStep(1);
    setParcels([makeDefaultParcel(0, { id: "parcel_1", expanded: true })]);
    setTermsAccepted(false);
  };

  const trackHref = (c: string) =>
    embedded ? `/dashboard/track/${c}` : `/track/${c}`;

  if (!authReady) {
    return (
      <div
        className={embedded ? "ship dx-embed" : "wrap"}
        style={embedded ? undefined : { paddingTop: 48, paddingBottom: 64 }}
      >
        <div
          className="dx-skel"
          style={{ height: 220, maxWidth: 640, margin: "0 auto" }}
        />
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

  if (manualPaymentState) {
    const ms = manualPaymentState.shipment;
    const mp = manualPaymentState.payment;
    return (
      <div className={embedded ? "ship dx-embed" : "wrap"}>
        <div className="done" style={{ maxWidth: 660 }}>
          <div className="eyebrow c">
            {mp.status === "paid"
              ? "Payment approved"
              : mp.status === "pending_review"
                ? "Payment proof submitted"
                : "Complete payment to release dispatch"}
          </div>
          <h1
            className="bebas"
            style={{
              fontWeight: 400,
              fontSize: "clamp(2.2rem,8vw,3.4rem)",
              lineHeight: 0.95,
              marginBottom: 12,
            }}
          >
            BOOKING {ms.code}
          </h1>
          <p className="lead" style={{ marginBottom: 20 }}>
            Route: {ms.sender.city} → {ms.receiver.city}. You can pay now below or come back anytime from Dashboard → Sent.
          </p>

          <div style={{ textAlign: "left" }}>
            <ManualPaymentPanel
              payment={mp}
              trackingHref={trackHref(ms.code)}
              onUpdated={(nextPayment) => {
                setManualPaymentState((prev) =>
                  prev ? { ...prev, payment: nextPayment } : prev
                );
              }}
            />
          </div>

          <div className="acts" style={{ justifyContent: "center", marginTop: 18 }}>
            <Link className="sw-btn sw-btn-ghost sw-btn-lg" to="/dashboard/sent">
              Go to Sent &amp; Drafts
            </Link>
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-lg"
              onClick={handleResetWizard}
            >
              Start another shipment
            </button>
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
              <small
                style={{
                  color: "var(--muted)",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                Total {formatMoney(confirmingPayment.totalUsd)} · Parcel
                dispatches once webhook verifies settlement
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

      {resumePromptDraft && (
        <div
          className="panel"
          style={{
            marginBottom: 16,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <b style={{ display: "block", fontSize: 14 }}>
              Continue your shipment: {resumePromptDraft.data.sCity || resumePromptDraft.data.sCountry} →{" "}
              {resumePromptDraft.data.rCity || resumePromptDraft.data.rCountry} (Step{" "}
              {resumePromptDraft.step} of 4)
            </b>
            <small style={{ color: "var(--muted)", fontSize: 12.5 }}>
              Saved {formatTimeAgo(resumePromptDraft.updatedAtMs)} · continue or start fresh
            </small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="sw-btn sw-btn-em"
              onClick={() => {
                appliedDraftRef.current = resumePromptDraft.id;
                applyDraftRecord(resumePromptDraft);
              }}
            >
              Continue draft
            </button>
            <button
              type="button"
              className="sw-btn sw-btn-ghost"
              onClick={async () => {
                if (user) {
                  await deleteUserDraft(user.uid, resumePromptDraft).catch(
                    () => null
                  );
                }
                setResumePromptDraft(null);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Discard
            </button>
          </div>
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
                    persistDraftNow();
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
                      persistDraftNow();
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
              {parcels.map((parcel, idx) => {
                const billable = computeParcelBillableKg(parcel);
                const valNum = Math.max(0, Number(parcel.declaredValue) || 0);
                const kgErr = errors[`parcel_${idx}_kg`];
                const photoErr = errors[`parcel_${idx}_photos`];
                const contentsErr = errors[`parcel_${idx}_contents`];
                const valErr = errors[`parcel_${idx}_val`];
                const summaryTitle = parcel.contents.trim() || `Parcel ${idx + 1}`;
                const summaryMeta = `${billable.toFixed(1)} kg · ${formatMoney(valNum)}`;

                return (
                  <div
                    key={parcel.id}
                    className="panel"
                    style={{ marginBottom: 14 }}
                  >
                    <div
                      className="panel-h"
                      style={{
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          minWidth: 0,
                          flex: "1 1 180px",
                        }}
                      >
                        <div className="pi">
                          <Boxes className="w-[17px] h-[17px]" />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <b
                            style={{
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {parcel.expanded
                              ? parcels.length > 1
                                ? `Parcel ${idx + 1} of ${parcels.length}`
                                : "Package details"
                              : `${summaryTitle} · ${summaryMeta}`}
                          </b>
                          <small>
                            {parcel.expanded
                              ? "Chargeable weight uses the higher of actual and volumetric"
                              : `${parcel.packageType} · ${parcel.photos.length} photo${parcel.photos.length === 1 ? "" : "s"}`}
                          </small>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {!parcel.expanded ? (
                          <button
                            type="button"
                            className="sw-btn sw-btn-ghost"
                            style={{ padding: "6px 12px", fontSize: 12 }}
                            onClick={() =>
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                expanded: true,
                              }))
                            }
                          >
                            Edit
                          </button>
                        ) : parcels.length > 1 ? (
                          <button
                            type="button"
                            className="sw-btn sw-btn-ghost"
                            style={{ padding: "6px 12px", fontSize: 12 }}
                            onClick={() =>
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                expanded: false,
                              }))
                            }
                          >
                            Collapse
                          </button>
                        ) : null}

                        {idx > 0 && (
                          <button
                            type="button"
                            className="sw-btn sw-btn-ghost"
                            style={{ padding: "6px 10px", fontSize: 12 }}
                            aria-label={`Remove parcel ${idx + 1}`}
                            onClick={() => {
                              parcel.photos.forEach((p) => {
                                if (p.previewUrl.startsWith("blob:")) {
                                  URL.revokeObjectURL(p.previewUrl);
                                }
                              });
                              setParcels((prev) =>
                                prev.filter((item) => item.id !== parcel.id)
                              );
                              setErrors({});
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {parcel.expanded && (
                      <div className="panel-b">
                        <div className="g2">
                          <div className={`fw ${kgErr ? "err" : ""}`}>
                            <label className="lbl" htmlFor={`parcel_${idx}_kg`}>
                              Weight (kg)
                            </label>
                            <input
                              id={`parcel_${idx}_kg`}
                              className="field"
                              type="number"
                              inputMode="decimal"
                              min="0.1"
                              step="0.1"
                              value={parcel.kg}
                              onChange={(e) =>
                                updateParcel(parcel.id, (cur) => ({
                                  ...cur,
                                  kg: e.target.value,
                                }))
                              }
                            />
                            {kgErr && <span className="ferr">{kgErr}</span>}
                          </div>
                          <div className="fw">
                            <label
                              className="lbl"
                              htmlFor={`parcel_${idx}_type`}
                            >
                              Package type
                            </label>
                            <select
                              id={`parcel_${idx}_type`}
                              className="field"
                              value={parcel.packageType}
                              onChange={(e) =>
                                updateParcel(parcel.id, (cur) => ({
                                  ...cur,
                                  packageType: e.target.value,
                                }))
                              }
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
                            <label className="lbl" htmlFor={`parcel_${idx}_l`}>
                              Length (cm)
                            </label>
                            <input
                              id={`parcel_${idx}_l`}
                              className="field"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              value={parcel.l}
                              onChange={(e) =>
                                updateParcel(parcel.id, (cur) => ({
                                  ...cur,
                                  l: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="fw">
                            <label className="lbl" htmlFor={`parcel_${idx}_w`}>
                              Width (cm)
                            </label>
                            <input
                              id={`parcel_${idx}_w`}
                              className="field"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              value={parcel.w}
                              onChange={(e) =>
                                updateParcel(parcel.id, (cur) => ({
                                  ...cur,
                                  w: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="fw">
                            <label className="lbl" htmlFor={`parcel_${idx}_h`}>
                              Height (cm)
                            </label>
                            <input
                              id={`parcel_${idx}_h`}
                              className="field"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              value={parcel.h}
                              onChange={(e) =>
                                updateParcel(parcel.id, (cur) => ({
                                  ...cur,
                                  h: e.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className={`fw ${photoErr ? "err" : ""}`}>
                          <label className="lbl">
                            Item photos (1–4 required){" "}
                            <span
                              style={{ float: "right", color: "var(--muted)" }}
                            >
                              {parcel.photos.length} / 4
                            </span>
                          </label>
                          <label
                            id={`parcel_${idx}_photos`}
                            className={`pf-zone ${parcel.dragOver ? "over" : ""}`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                dragOver: true,
                              }));
                            }}
                            onDragLeave={() =>
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                dragOver: false,
                              }))
                            }
                            onDrop={(e) => {
                              e.preventDefault();
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                dragOver: false,
                              }));
                              handlePhotoFiles(idx, e.dataTransfer.files);
                            }}
                          >
                            <Camera className="w-[26px] h-[26px] text-[var(--em)]" />
                            <b>Tap or drag photos to upload</b>
                            <small>
                              The receiver and operations reviewer will see
                              these. JPG/PNG, up to 4.
                            </small>
                            <input
                              ref={(el) => {
                                fileInputRefs.current[parcel.id] = el;
                              }}
                              type="file"
                              accept="image/*"
                              multiple
                              hidden
                              onChange={(e) => {
                                handlePhotoFiles(idx, e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>

                          {parcel.photos.length > 0 && (
                            <div className="pf-grid">
                              {parcel.photos.map((item, pIdx) => (
                                <div key={item.id} className="pf-th">
                                  <img
                                    src={item.previewUrl}
                                    alt={`Parcel ${idx + 1} item ${pIdx + 1}`}
                                  />
                                  <button
                                    type="button"
                                    aria-label="Remove photo"
                                    onClick={() => {
                                      if (item.previewUrl.startsWith("blob:")) {
                                        URL.revokeObjectURL(item.previewUrl);
                                      }
                                      updateParcel(parcel.id, (cur) => ({
                                        ...cur,
                                        photos: cur.photos.filter(
                                          (_, i) => i !== pIdx
                                        ),
                                      }));
                                    }}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {photoErr && <span className="ferr">{photoErr}</span>}
                        </div>

                        <div className={`fw ${contentsErr ? "err" : ""}`}>
                          <label
                            className="lbl"
                            htmlFor={`parcel_${idx}_contents`}
                          >
                            Contents
                          </label>
                          <input
                            id={`parcel_${idx}_contents`}
                            className="field"
                            value={parcel.contents}
                            onChange={(e) =>
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                contents: e.target.value,
                              }))
                            }
                            placeholder="e.g. Laptop, 2× linen shirts"
                          />
                          {contentsErr && (
                            <span className="ferr">{contentsErr}</span>
                          )}
                        </div>

                        <div className={`fw ${valErr ? "err" : ""}`}>
                          <label className="lbl" htmlFor={`parcel_${idx}_val`}>
                            Declared value (USD)
                          </label>
                          <input
                            id={`parcel_${idx}_val`}
                            className="field"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            value={parcel.declaredValue}
                            onChange={(e) =>
                              updateParcel(parcel.id, (cur) => ({
                                ...cur,
                                declaredValue: e.target.value,
                              }))
                            }
                          />
                          {valErr && <span className="ferr">{valErr}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {parcels.length < MAX_PARCELS && (
                <div style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    className="sw-btn sw-btn-ghost sw-btn-block"
                    onClick={() => {
                      const nextIdx = parcels.length;
                      setParcels((prev) => [
                        ...prev.map((p) => ({ ...p, expanded: false })),
                        makeDefaultParcel(nextIdx, { expanded: true }),
                      ]);
                    }}
                  >
                    + Add another parcel ({parcels.length}/{MAX_PARCELS})
                  </button>
                </div>
              )}

              <div className="acts">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  onClick={() => {
                    persistDraftNow();
                    setStep(1);
                  }}
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
                      persistDraftNow();
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
                  onClick={() => {
                    persistDraftNow();
                    setStep(2);
                  }}
                >
                  ← Back
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  onClick={() => {
                    setStep(4);
                    persistDraftNow();
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
                <div
                  className="tk-hold a"
                  style={{
                    marginBottom: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                  }}
                >
                  <AlertCircle className="w-5 h-5 hi shrink-0" />
                  <div>
                    <b>Payment notice</b>
                    <small>{cancelNotice}</small>
                  </div>
                </div>
              )}

              {!allPreviousValid && (
                <div
                  className="tk-hold r"
                  style={{
                    marginBottom: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(244, 63, 94, 0.35)",
                  }}
                >
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
                            expandParcelForFieldKey(fieldKey);
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
                      <span>Parcels ({parcels.length})</span>
                      <b>
                        {chargeableKg.toFixed(1)} kg · {formatMoney(declaredNum)} value
                      </b>
                    </div>
                    {parcels.map((parcel, idx) => {
                      const line = activeQuote.parcelLines[idx];
                      return (
                        <div
                          key={parcel.id}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid var(--border)",
                            background: "var(--card2)",
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <b style={{ fontSize: 13.5, wordBreak: "break-word" }}>
                              {parcels.length > 1 ? `#${idx + 1} · ` : ""}
                              {parcel.contents.trim() || `Parcel ${idx + 1}`}
                            </b>
                            <b style={{ fontSize: 13, color: "var(--em)" }}>
                              {formatMoney(line?.lineTotal || 0)}
                            </b>
                          </div>
                          <small style={{ color: "var(--muted)", fontSize: 12 }}>
                            {parcel.packageType} ·{" "}
                            {computeParcelBillableKg(parcel).toFixed(1)} kg ·
                            Value{" "}
                            {formatMoney(
                              Math.max(0, Number(parcel.declaredValue) || 0)
                            )}
                          </small>
                          {parcel.photos.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                              {parcel.photos.map((item, pIdx) => (
                                <img
                                  key={item.id}
                                  src={item.previewUrl}
                                  alt={`Parcel ${idx + 1} photo ${pIdx + 1}`}
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
                          )}
                        </div>
                      );
                    })}
                    <hr />
                    <div className="r">
                      <span>Service</span>
                      <b>
                        {SERVICES[service].name} · est. by{" "}
                        {formatShortDay(
                          addBusinessDays(new Date(), activeQuote.days[1] + 1)
                        )}
                      </b>
                    </div>
                    {activeAmounts.feeAmountUsd !== 0 && (
                      <div className="r">
                        <span>
                          {activeAmounts.feeAmountUsd > 0
                            ? "Payment fee"
                            : "Payment discount"}
                        </span>
                        <b>
                          {activeAmounts.feeAmountUsd > 0 ? "+" : "-"}
                          {formatMoney(Math.abs(activeAmounts.feeAmountUsd))}
                        </b>
                      </div>
                    )}
                    <div className="r">
                      <span>Total due ({parcels.length} parcel{parcels.length === 1 ? "" : "s"})</span>
                      <b style={{ color: "var(--em)" }}>
                        {formatMoney(activeAmounts.totalUsd)}
                        {activeAmounts.currency !== "USD" && (
                          <small
                            style={{
                              marginLeft: 6,
                              color: "var(--muted)",
                              fontWeight: 500,
                            }}
                          >
                            ({activeAmounts.convertedAmount}{" "}
                            {activeAmounts.currency})
                          </small>
                        )}
                      </b>
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
                  {eligibleMethods.length === 0 ? (
                    <div className="au-err" style={{ marginBottom: 14 }}>
                      <span>
                        No payment method is currently available for this route
                        or amount. Please contact support at support@mail.shipwell.cc.
                      </span>
                      <button
                        type="button"
                        className="sw-btn sw-btn-ghost"
                        style={{ marginTop: 8, padding: "5px 10px", fontSize: 12 }}
                        onClick={() => openContact()}
                      >
                        Contact support
                      </button>
                    </div>
                  ) : (
                    <div className="pay">
                      {eligibleMethods.map((pm) => {
                        const Icon = getMethodIcon(pm.type);
                        const pmAmt = calculateMethodAmounts(
                          activeQuote.total,
                          pm
                        );
                        return (
                          <label key={pm.id} style={{ cursor: "pointer" }}>
                            <input
                              type="radio"
                              name="pay"
                              value={pm.id}
                              checked={selectedMethod?.id === pm.id}
                              onChange={() => setSelectedMethodId(pm.id)}
                            />
                            <span>
                              {pm.iconUrl ? (
                                <img
                                  src={pm.iconUrl}
                                  alt=""
                                  style={{
                                    width: 20,
                                    height: 20,
                                    objectFit: "contain",
                                    borderRadius: 4,
                                  }}
                                />
                              ) : (
                                <Icon className="w-5 h-5" />
                              )}
                              <b>{pm.name}</b>
                              <small style={{ fontSize: 11, fontWeight: 400 }}>
                                {pm.subtitle}
                                {pmAmt.feeAmountUsd !== 0
                                  ? ` · ${pmAmt.feeAmountUsd > 0 ? "+" : "-"}${formatMoney(Math.abs(pmAmt.feeAmountUsd))}`
                                  : ""}
                                {pmAmt.currency !== "USD"
                                  ? ` · ${pmAmt.convertedAmount} ${pmAmt.currency}`
                                  : ""}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {!methodsLoaded && (
                    <small style={{ color: "var(--muted)", fontSize: 11.5 }}>
                      Refreshing live payment options…
                    </small>
                  )}

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
                    <div
                      className="au-err"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "grid", gap: 3 }}>
                        <span>{submitError.title}</span>
                        <small style={{ fontSize: 11.5, opacity: 0.85 }}>
                          {submitError.details}
                        </small>
                      </div>
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
                  onClick={() => {
                    persistDraftNow();
                    setStep(3);
                  }}
                >
                  ← Back
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  disabled={
                    submitting ||
                    !termsAccepted ||
                    !allPreviousValid ||
                    !selectedMethod
                  }
                  onClick={handleConfirm}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {submitting
                    ? "Processing booking..."
                    : selectedMethod?.type === "cash"
                      ? "Confirm Booking"
                      : selectedMethod?.type === "automatic"
                        ? `Confirm & Pay ${formatMoney(activeAmounts.totalUsd)}`
                        : `Create Booking · ${formatMoney(activeAmounts.totalUsd)}`}
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
              <small>
                {draftSaveLabel
                  ? `${draftSaveLabel} · recalculated at checkout`
                  : "Updates as you type · recalculated at checkout"}
              </small>
            </div>
            <div className="sum-b">
              <div className="sr">
                <span>Route</span>
                <b>
                  {sCity} → {rCity}
                </b>
              </div>
              <div className="sr">
                <span>Parcels</span>
                <b>
                  {parcels.length} ({chargeableKg.toFixed(1)} kg)
                </b>
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
              {activeQuote.parcelLines.map((line, idx) => (
                <div key={line.id} className="sr">
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 185,
                    }}
                  >
                    #{idx + 1} {line.label} ({line.billableKg.toFixed(1)} kg)
                  </span>
                  <b>{formatMoney(line.lineTotal)}</b>
                </div>
              ))}
              {parcels.length > 1 && <hr />}
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
              {activeAmounts.feeAmountUsd !== 0 && (
                <div className="sr">
                  <span>
                    {activeAmounts.feeAmountUsd > 0
                      ? "Method fee"
                      : "Method discount"}
                  </span>
                  <b>
                    {activeAmounts.feeAmountUsd > 0 ? "+" : "-"}
                    {formatMoney(Math.abs(activeAmounts.feeAmountUsd))}
                  </b>
                </div>
              )}
              <hr />
              <div className="sum-tot">
                <span>Total</span>
                <b>{formatMoney(activeAmounts.totalUsd)}</b>
              </div>
              {activeAmounts.currency !== "USD" && (
                <div className="sr">
                  <span>Pay in {activeAmounts.currency}</span>
                  <b>
                    {activeAmounts.convertedAmount} {activeAmounts.currency}
                  </b>
                </div>
              )}
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
          <b>{formatMoney(activeAmounts.totalUsd)}</b>
        </div>
        <span className="chip g">{SERVICES[service].name}</span>
      </div>
    </div>
  );
}
