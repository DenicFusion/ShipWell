import type { PaymentMethodRecord } from "@/types/tracking";

export const DEFAULT_PAYMENT_METHODS: PaymentMethodRecord[] = [
  {
    id: "bachs",
    name: "Card / Instant online (Bachs)",
    subtitle: "Instant confirmation · Visa, Mastercard & online settlement",
    type: "automatic",
    gateway: "bachs",
    enabled: true,
    order: 1,
    currency: "USD",
    exchangeRate: 1,
    details: [],
    instructions:
      "You will be redirected to secure Bachs checkout to complete your payment for {trackingCode}.",
    fee: { mode: "none", kind: "fee", amount: 0 },
    rules: {
      minAmount: 0,
      maxAmount: 0,
      allowedCountries: [],
      appliesTo: "both",
      audience: "everyone",
    },
    proof: {
      required: false,
      fields: {
        screenshot: false,
        txId: false,
        senderName: false,
        paidAt: false,
      },
      approval: "auto",
    },
    windowMinutes: 60,
  },
  {
    id: "pay_on_delivery",
    name: "Pay on delivery / pickup",
    subtitle: "Settle cash or terminal when courier collects or delivers",
    type: "cash",
    gateway: null,
    enabled: true,
    order: 2,
    currency: "USD",
    exchangeRate: 1,
    details: [],
    instructions:
      "Your booking is confirmed immediately. Please have {amount} {currency} ready when the courier collects or delivers {trackingCode}.",
    fee: { mode: "none", kind: "fee", amount: 0 },
    rules: {
      minAmount: 0,
      maxAmount: 0,
      allowedCountries: [],
      appliesTo: "shipping",
      audience: "everyone",
    },
    proof: {
      required: false,
      fields: {
        screenshot: false,
        txId: false,
        senderName: false,
        paidAt: false,
      },
      approval: "auto",
    },
    windowMinutes: 1440,
  },
  {
    id: "bank_transfer_sample",
    name: "Bank transfer (Wire / ACH)",
    subtitle: "Direct transfer with reference number & receipt upload",
    type: "bank_transfer",
    gateway: null,
    enabled: false,
    order: 3,
    currency: "USD",
    exchangeRate: 1,
    details: [
      { label: "Bank name", value: "Mercury Business Bank", copyable: true },
      { label: "Account name", value: "ShipWell Logistics Ltd.", copyable: true },
      { label: "Account number", value: "0000000000", copyable: true },
      { label: "Routing / SWIFT", value: "000000000", copyable: true },
    ],
    instructions:
      "Transfer {amount} {currency} to the account above and include {reference} in the payment memo. Upload your transfer receipt below so our team can confirm your booking.",
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
        paidAt: true,
      },
      approval: "manual",
    },
    windowMinutes: 1440,
  },
  {
    id: "crypto_usdt_sample",
    name: "Crypto (USDT TRC-20)",
    subtitle: "Pay with USDT and submit your transaction hash",
    type: "crypto",
    gateway: null,
    enabled: false,
    order: 4,
    currency: "USDT",
    exchangeRate: 1,
    details: [
      { label: "Network", value: "TRON (TRC-20)", copyable: false },
      { label: "Wallet address", value: "TExampleWalletAddressUpdateInAdmin", copyable: true },
    ],
    instructions:
      "Send exactly {amount} {currency} on TRON (TRC-20) to the wallet address above, then submit your TXID hash and screenshot below.",
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
        senderName: false,
        paidAt: false,
      },
      approval: "manual",
    },
    windowMinutes: 180,
  },
];

export function calculateMethodAmounts(
  baseUsd: number,
  method: PaymentMethodRecord
): {
  baseUsd: number;
  feeAmountUsd: number;
  totalUsd: number;
  currency: string;
  exchangeRate: number;
  convertedAmount: number;
} {
  const safeBase = Math.max(0, Number(baseUsd || 0));
  const rawFeeAmt = Number(method.fee?.amount || 0);
  let delta = 0;
  if (method.fee?.mode === "fixed" && rawFeeAmt > 0) {
    delta = rawFeeAmt;
  } else if (method.fee?.mode === "percent" && rawFeeAmt > 0) {
    delta = (safeBase * rawFeeAmt) / 100;
  }
  const signedFee = method.fee?.kind === "discount" ? -delta : delta;
  const totalUsd = Number(Math.max(0, safeBase + signedFee).toFixed(2));
  const feeAmountUsd = Number(signedFee.toFixed(2));
  const currency = (method.currency || "USD").trim().toUpperCase();
  const rate = Number(method.exchangeRate) > 0 ? Number(method.exchangeRate) : 1;
  const convertedAmount = Number((totalUsd * rate).toFixed(2));

  return {
    baseUsd: Number(safeBase.toFixed(2)),
    feeAmountUsd,
    totalUsd,
    currency,
    exchangeRate: rate,
    convertedAmount,
  };
}

export function filterEligiblePaymentMethods(params: {
  methods: PaymentMethodRecord[];
  appliesTo: "shipping" | "customs";
  amountUsd: number;
  country?: string;
  isBusiness?: boolean;
}): PaymentMethodRecord[] {
  const cleanCountry = String(params.country || "").trim().toLowerCase();
  return [...params.methods]
    .filter((m) => {
      if (!m.enabled) return false;
      const scope = m.rules?.appliesTo || "both";
      if (scope !== "both" && scope !== params.appliesTo) return false;
      const aud = m.rules?.audience || "everyone";
      if (aud === "business" && !params.isBusiness) return false;
      const min = Number(m.rules?.minAmount || 0);
      const max = Number(m.rules?.maxAmount || 0);
      if (min > 0 && params.amountUsd < min) return false;
      if (max > 0 && params.amountUsd > max) return false;
      const countries = Array.isArray(m.rules?.allowedCountries)
        ? m.rules.allowedCountries.map((c) => c.trim().toLowerCase()).filter(Boolean)
        : [];
      if (countries.length > 0 && cleanCountry && !countries.includes(cleanCountry)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function formatMethodInstructions(
  template: string,
  vars: {
    amount: string | number;
    currency: string;
    reference: string;
    trackingCode: string;
    name: string;
  }
): string {
  return String(template || "")
    .replace(/\{amount\}/gi, String(vars.amount))
    .replace(/\{currency\}/gi, String(vars.currency || "USD"))
    .replace(/\{reference\}/gi, String(vars.reference || ""))
    .replace(/\{trackingCode\}/gi, String(vars.trackingCode || ""))
    .replace(/\{name\}/gi, String(vars.name || "Customer"));
}
