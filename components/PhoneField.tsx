import { useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import {
  DIAL_COUNTRIES,
  countryNameToIso2,
  detectVisitorLocale,
  formatPhoneValue,
  getDialCountry,
  splitPhoneForInput,
} from "../lib/phone.ts";

interface PhoneFieldProps {
  id?: string;
  label?: string;
  required?: boolean;
  value: string;
  onChange: (formattedValue: string) => void;
  countryHint?: string;
  hasError?: boolean;
}

export function PhoneField({
  id,
  label = "Phone",
  required = false,
  value,
  onChange,
  countryHint,
  hasError = false,
}: PhoneFieldProps) {
  const fallbackIso: CountryCode = countryHint
    ? countryNameToIso2(countryHint)
    : detectVisitorLocale().iso2;

  const initial = splitPhoneForInput(value, fallbackIso);
  const [prevValue, setPrevValue] = useState(value);
  const [iso2, setIso2] = useState<CountryCode>(initial.iso2);
  const [national, setNational] = useState<string>(initial.national);
  const [isFocused, setIsFocused] = useState(false);

  if (value !== prevValue) {
    setPrevValue(value);
    if (!isFocused) {
      const split = splitPhoneForInput(value, fallbackIso);
      if (split.iso2 !== iso2) setIso2(split.iso2);
      if (split.national !== national) setNational(split.national);
    }
  }

  const activeCountry = getDialCountry(iso2);

  const emitChange = (nextIso: CountryCode, nextNum: string) => {
    const formatted = nextNum.trim() ? formatPhoneValue(nextIso, nextNum) : "";
    setPrevValue(formatted);
    onChange(formatted);
  };

  const handleIsoChange = (nextIso: CountryCode) => {
    setIso2(nextIso);
    if (national.trim()) {
      emitChange(nextIso, national);
    }
  };

  const handleNumberChange = (nextNum: string) => {
    setNational(nextNum);
    emitChange(iso2, nextNum);
  };

  return (
    <div className="fld">
      {label ? (
        <label className="lbl" htmlFor={id}>
          {label} {required ? "*" : ""}
        </label>
      ) : null}
      <div className={`phone-row${hasError ? " bad" : ""}`}>
        <select
          aria-label="Country dial code"
          className="phone-cc"
          value={iso2}
          onChange={(e) => handleIsoChange(e.target.value as CountryCode)}
        >
          {DIAL_COUNTRIES.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {c.flag} {c.dial} ({c.iso2})
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          placeholder={activeCountry.sampleNational}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
            if (national.trim()) {
              const split = splitPhoneForInput(formatPhoneValue(iso2, national), iso2);
              setIso2(split.iso2);
              setNational(split.national);
            }
          }}
          onChange={(e) => handleNumberChange(e.target.value)}
        />
      </div>
    </div>
  );
}
