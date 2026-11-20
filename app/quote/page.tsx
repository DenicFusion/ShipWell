"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, DollarSign, Shield, TrendingUp, Zap } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  addBusinessDays,
  calculateShippingPricing,
  COUNTRIES,
  formatMoney,
  formatShortDay,
  PLACES,
  SERVICES,
} from "@/lib/quote-engine";
import type { ServiceTier } from "@/types/tracking";

export default function QuotePage() {
  const router = useRouter();
  const [from, setFrom] = useState("Nigeria");
  const [to, setTo] = useState("United Kingdom");
  const [kg, setKg] = useState("1.5");
  const [val, setVal] = useState("250");
  const [pickupDate, setPickupDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [selectedSvc, setSelectedSvc] = useState<ServiceTier>("standard");

  const weightNum = Math.max(0.1, Number(kg) || 0.1);
  const valueNum = Math.max(0, Number(val) || 0);

  const quotes = useMemo(() => {
    return (["economy", "standard", "express"] as ServiceTier[]).map((tier) =>
      calculateShippingPricing(from, to, weightNum, valueNum, tier)
    );
  }, [from, to, weightNum, valueNum]);

  const activeQuote =
    quotes.find((q) => q.service === selectedSvc) || quotes[1];
  const baseDate = pickupDate ? new Date(`${pickupDate}T09:00:00`) : new Date();

  const handleBook = () => {
    const params = new URLSearchParams({
      from,
      to,
      kg: String(weightNum),
      val: String(valueNum),
      svc: selectedSvc,
    });
    router.push(`/ship?${params.toString()}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="sw-main quote flex-1">
        <div className="wrap">
          <div className="phead">
            <div className="eyebrow">Instant Pricing Engine</div>
            <h1>
              GET AN
              <br />
              INSTANT QUOTE
            </h1>
            <p>
              Real-time estimates for any route. Adjust the details and watch
              every service level update.
            </p>
          </div>

          <div className="q-grid">
            <div className="panel">
              <div className="panel-h">
                <div className="pi">
                  <DollarSign className="w-[17px] h-[17px]" />
                </div>
                <div>
                  <b>Logistics cost calculator</b>
                  <small>Estimates valid for 72 hours</small>
                </div>
              </div>
              <div className="panel-b">
                <div className="fw">
                  <label className="lbl" htmlFor="qFrom">
                    Origin
                  </label>
                  <select
                    id="qFrom"
                    className="field"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c} ({PLACES[c].city})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fw">
                  <label className="lbl" htmlFor="qTo">
                    Destination
                  </label>
                  <select
                    id="qTo"
                    className="field"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c} ({PLACES[c].city})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="g2 keep">
                  <div className="fw">
                    <label className="lbl" htmlFor="qKg">
                      Weight (kg)
                    </label>
                    <input
                      id="qKg"
                      className="field"
                      type="number"
                      inputMode="decimal"
                      min="0.1"
                      step="0.1"
                      value={kg}
                      onChange={(e) => setKg(e.target.value)}
                    />
                  </div>
                  <div className="fw">
                    <label className="lbl" htmlFor="qVal">
                      Declared value ($)
                    </label>
                    <input
                      id="qVal"
                      className="field"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={val}
                      onChange={(e) => setVal(e.target.value)}
                    />
                  </div>
                </div>

                <div className="fw">
                  <label className="lbl" htmlFor="qDate">
                    Pickup date
                  </label>
                  <input
                    id="qDate"
                    className="field"
                    type="date"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                  />
                </div>

                <div className="note">
                  Rates include fuel surcharge and basic cover. Dimensions are
                  confirmed at booking — volumetric weight can change the final
                  price.
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <div className="pi">
                  <TrendingUp className="w-[17px] h-[17px]" />
                </div>
                <div>
                  <b>
                    {PLACES[from]?.city} → {PLACES[to]?.city} ·{" "}
                    {activeQuote.dist.toLocaleString()} km
                  </b>
                  <small>
                    Live index · tap a service to see the breakdown
                  </small>
                </div>
              </div>

              <div className="tiers">
                {quotes.map((q) => {
                  const svcMeta = SERVICES[q.service];
                  const isSel = q.service === selectedSvc;
                  const estEnd = formatShortDay(
                    addBusinessDays(baseDate, q.days[1])
                  );
                  return (
                    <button
                      key={q.service}
                      type="button"
                      className={`tier ${isSel ? "sel" : ""}`}
                      onClick={() => setSelectedSvc(q.service)}
                    >
                      <div className="ti">
                        {q.service === "express" ? (
                          <Zap className="w-5 h-5" />
                        ) : q.service === "standard" ? (
                          <Shield className="w-5 h-5" />
                        ) : (
                          <Clock className="w-5 h-5" />
                        )}
                      </div>
                      <div className="tn">
                        <b>
                          {svcMeta.name}
                          {svcMeta.popular && <i>Popular</i>}
                        </b>
                        <small>
                          {q.days[0]}–{q.days[1]} business days · Est. by{" "}
                          {estEnd}
                        </small>
                      </div>
                      <div className="tp">
                        <b>{formatMoney(q.total)}</b>
                        <small>{svcMeta.blurb.split(" · ")[0]}</small>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="brk">
                <h6>Cost breakdown</h6>
                <div className="sr">
                  <span>Base freight ({weightNum.toFixed(1)} kg)</span>
                  <b>{formatMoney(activeQuote.base)}</b>
                </div>
                <div className="sr">
                  <span>Fuel surcharge (12%)</span>
                  <b>{formatMoney(activeQuote.fuel)}</b>
                </div>
                <div className="sr">
                  <span>Transit insurance cover</span>
                  <b>{formatMoney(activeQuote.cover)}</b>
                </div>
                <div className="sr">
                  <span>Customs &amp; clearance handling</span>
                  <b>
                    {activeQuote.intl ? formatMoney(activeQuote.duty) : "$0.00"}
                  </b>
                </div>
                <div className="tot">
                  <span>Estimated total</span>
                  <b>{formatMoney(activeQuote.total)}</b>
                </div>
              </div>

              <div style={{ padding: "0 22px 24px" }}>
                <button
                  type="button"
                  onClick={handleBook}
                  className="sw-btn sw-btn-amber sw-btn-lg sw-btn-block"
                >
                  Book at this rate →
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
