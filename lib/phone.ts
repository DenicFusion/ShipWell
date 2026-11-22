import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface DialCountry {
  iso2: CountryCode;
  name: string;
  dial: string;
  flag: string;
  sampleNational: string;
}

export const DIAL_COUNTRIES: DialCountry[] = [
  { iso2: "US", name: "United States", dial: "+1", flag: "🇺🇸", sampleNational: "202 555 0123" },
  { iso2: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧", sampleNational: "20 7946 0958" },
  { iso2: "CA", name: "Canada", dial: "+1", flag: "🇨🇦", sampleNational: "416 555 0192" },
  { iso2: "DE", name: "Germany", dial: "+49", flag: "🇩🇪", sampleNational: "30 901820" },
  { iso2: "FR", name: "France", dial: "+33", flag: "🇫🇷", sampleNational: "1 42 68 55 00" },
  { iso2: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪", sampleNational: "50 555 0194" },
  { iso2: "AU", name: "Australia", dial: "+61", flag: "🇦🇺", sampleNational: "2 9374 4000" },
  { iso2: "JP", name: "Japan", dial: "+81", flag: "🇯🇵", sampleNational: "3 5555 0199" },
  { iso2: "CN", name: "China", dial: "+86", flag: "🇨🇳", sampleNational: "21 5555 0188" },
  { iso2: "IN", name: "India", dial: "+91", flag: "🇮🇳", sampleNational: "22 5555 0144" },
  { iso2: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬", sampleNational: "803 555 0199" },
  { iso2: "GH", name: "Ghana", dial: "+233", flag: "🇬🇭", sampleNational: "24 555 0122" },
  { iso2: "ZA", name: "South Africa", dial: "+27", flag: "🇿🇦", sampleNational: "11 555 0188" },
  { iso2: "KE", name: "Kenya", dial: "+254", flag: "🇰🇪", sampleNational: "712 555 019" },
  { iso2: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱", sampleNational: "20 555 0177" },
  { iso2: "ES", name: "Spain", dial: "+34", flag: "🇪🇸", sampleNational: "91 555 0166" },
  { iso2: "IT", name: "Italy", dial: "+39", flag: "🇮🇹", sampleNational: "06 555 0155" },
  { iso2: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬", sampleNational: "6555 0144" },
  { iso2: "BR", name: "Brazil", dial: "+55", flag: "🇧🇷", sampleNational: "11 5555 0133" },
  { iso2: "MX", name: "Mexico", dial: "+52", flag: "🇲🇽", sampleNational: "55 5555 0122" },
];

const COUNTRY_NAME_TO_ISO: Record<string, CountryCode> = {
  "United States": "US",
  "United Kingdom": "GB",
  Canada: "CA",
  Germany: "DE",
  France: "FR",
  "United Arab Emirates": "AE",
  Australia: "AU",
  Japan: "JP",
  China: "CN",
  India: "IN",
  Nigeria: "NG",
  Ghana: "GH",
  "South Africa": "ZA",
  Kenya: "KE",
  Netherlands: "NL",
  Spain: "ES",
  Italy: "IT",
  Singapore: "SG",
  Brazil: "BR",
  Mexico: "MX",
};

const ISO_TO_SHIPPING_COUNTRY: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  UK: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  AE: "United Arab Emirates",
  AU: "Australia",
  JP: "Japan",
  CN: "China",
  IN: "India",
  NG: "Nigeria",
  GH: "Ghana",
  ZA: "South Africa",
  KE: "Kenya",
};

const TZ_TO_ISO: Array<[RegExp, CountryCode]> = [
  [/America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Detroit|Anchorage|Honolulu)/i, "US"],
  [/America\/(Toronto|Vancouver|Montreal|Edmonton|Winnipeg|Halifax)/i, "CA"],
  [/Europe\/London/i, "GB"],
  [/Europe\/Berlin/i, "DE"],
  [/Europe\/Paris/i, "FR"],
  [/Asia\/Dubai/i, "AE"],
  [/Australia\//i, "AU"],
  [/Asia\/Tokyo/i, "JP"],
  [/Asia\/Shanghai/i, "CN"],
  [/Asia\/(Kolkata|Calcutta)/i, "IN"],
  [/Africa\/Lagos/i, "NG"],
  [/Africa\/Accra/i, "GH"],
  [/Africa\/Johannesburg/i, "ZA"],
  [/Africa\/Nairobi/i, "KE"],
];

export function detectVisitorLocale(): {
  iso2: CountryCode;
  countryName: string;
  dial: string;
} {
  if (typeof window === "undefined") {
    return { iso2: "US", countryName: "United States", dial: "+1" };
  }

  let detectedIso: CountryCode | undefined;

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    for (const [re, iso] of TZ_TO_ISO) {
      if (re.test(tz)) {
        detectedIso = iso;
        break;
      }
    }
  } catch {
    // ignore
  }

  if (!detectedIso && typeof navigator !== "undefined") {
    const lang = navigator.language || "";
    const region = lang.split("-")[1]?.toUpperCase();
    if (region && DIAL_COUNTRIES.some((c) => c.iso2 === region)) {
      detectedIso = region as CountryCode;
    }
  }

  const finalIso: CountryCode = detectedIso || "US";
  const match = DIAL_COUNTRIES.find((c) => c.iso2 === finalIso) || DIAL_COUNTRIES[0];
  const countryName = ISO_TO_SHIPPING_COUNTRY[finalIso] || "United States";
  return { iso2: match.iso2, countryName, dial: match.dial };
}

export function countryNameToIso2(countryName?: string): CountryCode {
  if (!countryName) return "US";
  return COUNTRY_NAME_TO_ISO[countryName] || "US";
}

export function getDialCountry(iso2?: CountryCode): DialCountry {
  return DIAL_COUNTRIES.find((c) => c.iso2 === iso2) || DIAL_COUNTRIES[0];
}

export function splitPhoneForInput(
  value: string,
  fallbackIso?: CountryCode
): { iso2: CountryCode; national: string } {
  const raw = String(value || "").trim();
  if (!raw) {
    return { iso2: fallbackIso || detectVisitorLocale().iso2, national: "" };
  }

  const parsed = parsePhoneNumberFromString(raw, fallbackIso || "US");
  if (parsed && parsed.country) {
    return {
      iso2: parsed.country,
      national: parsed.nationalNumber || raw.replace(/^\+\d+\s*/, ""),
    };
  }

  if (raw.startsWith("+")) {
    const sorted = [...DIAL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      if (raw.startsWith(c.dial)) {
        return {
          iso2: c.iso2,
          national: raw.slice(c.dial.length).trim(),
        };
      }
    }
  }

  return { iso2: fallbackIso || "US", national: raw };
}

export function formatPhoneValue(iso2: CountryCode, nationalInput: string): string {
  const raw = String(nationalInput || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) {
    const parsedDirect = parsePhoneNumberFromString(raw);
    return parsedDirect ? parsedDirect.formatInternational() : raw;
  }
  const c = getDialCountry(iso2);
  const cleaned = raw.replace(/^0+/, "");
  const candidate = `${c.dial} ${cleaned}`;
  const parsed = parsePhoneNumberFromString(candidate, iso2);
  if (parsed) {
    return parsed.formatInternational();
  }
  return `${c.dial} ${raw}`;
}

export function validateInternationalPhone(
  phoneInput: string,
  defaultIso2: CountryCode = "US"
): { valid: boolean; e164: string; international: string; error?: string } {
  const raw = String(phoneInput || "").trim();
  if (!raw) {
    return {
      valid: false,
      e164: "",
      international: "",
      error: "Phone number is required.",
    };
  }

  const parsed = parsePhoneNumberFromString(raw, defaultIso2);
  if (!parsed || !parsed.isPossible() || !parsed.isValid()) {
    return {
      valid: false,
      e164: "",
      international: raw,
      error: "Enter a valid phone number with country code.",
    };
  }

  return {
    valid: true,
    e164: parsed.number,
    international: parsed.formatInternational(),
  };
}
