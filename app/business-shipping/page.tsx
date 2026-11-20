"use client";

import React, { useState } from "react";
import {
  Building2,
  Check,
  Clock,
  DollarSign,
  FileText,
  Globe,
  Loader2,
  Monitor,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { submitBusinessLead } from "@/lib/firestore-shipments";
import toast from "react-hot-toast";

export default function BusinessShippingPage() {
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<"Starter" | "Growth" | "Enterprise">(
    "Growth"
  );
  const [volume, setVolume] = useState("200 – 1,000 parcels");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submittedRef, setSubmittedRef] = useState("");

  const selectPlan = (chosen: "Starter" | "Growth" | "Enterprise") => {
    setPlan(chosen);
    const el = document.getElementById("bizForm");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!company.trim() || !name.trim() || !email.includes("@")) {
      setError("Please enter your company, name, and a valid work email.");
      return;
    }
    setBusy(true);
    try {
      const ref = await submitBusinessLead({
        company,
        name,
        email,
        plan,
        volume,
        message,
      });
      await fetch("/api/leads/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref,
          company,
          name,
          email,
          plan,
          volume,
          message,
        }),
      }).catch(() => null);
      setSubmittedRef(ref);
      toast.success("Rate card request submitted!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not submit your request."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="sw-main biz flex-1">
        <section className="bhero">
          <div className="wrap">
            <div className="bbadge">
              <i />
              Enterprise Logistics
            </div>
            <h1>
              <span className="l">SHIP SMARTER.</span>
              <span className="l b">SCALE FASTER.</span>
            </h1>
            <p className="lead">
              ShipWell Business is built for companies moving 50+ parcels a
              month — volume pricing, dedicated support and full logistics
              intelligence in one portal.
            </p>
            <div className="row">
              <a className="sw-btn sw-btn-blue sw-btn-lg" href="#bizForm">
                Open Business Account
              </a>
              <a className="sw-btn sw-btn-ghost sw-btn-lg" href="#bizPlans">
                View Plans
              </a>
            </div>
          </div>
        </section>

        <div className="bstats">
          <div className="bs">
            <b>30%</b>
            <span>Off standard rates</span>
          </div>
          <div className="bs">
            <b>180+</b>
            <span>Countries covered</span>
          </div>
          <div className="bs">
            <b>99.98%</b>
            <span>On-time delivery</span>
          </div>
          <div className="bs">
            <b>24/7</b>
            <span>Dedicated support</span>
          </div>
        </div>

        <section className="sec">
          <div className="wrap">
            <div className="sec-head">
              <div className="eyebrow" style={{ color: "var(--blue)" }}>
                Platform
              </div>
              <h2 className="h2-display">BUILT FOR VOLUME.</h2>
            </div>

            <div className="bfeat">
              {[
                {
                  icon: TrendingUp,
                  title: "Volume Pricing Engine",
                  text: "Automatic rate tiers by monthly volume — save up to 30% on every consignment.",
                },
                {
                  icon: FileText,
                  title: "Bulk CSV Upload",
                  text: "Import hundreds of orders at once. Validated, dispatched and tracked automatically.",
                },
                {
                  icon: Users,
                  title: "Team Access & Roles",
                  text: "Admin, shipper, finance and viewer roles with a full audit trail.",
                },
                {
                  icon: Shield,
                  title: "Priority Customs",
                  text: "A dedicated brokerage desk clears your freight in 24–48 hours with pre-filed paperwork.",
                },
                {
                  icon: Monitor,
                  title: "API & Webhooks",
                  text: "Create shipments, pull labels and receive tracking events straight into your systems.",
                },
                {
                  icon: DollarSign,
                  title: "Monthly Invoicing",
                  text: "One consolidated invoice at month-end. Ship now, settle later.",
                },
              ].map((feat) => {
                const Icon = feat.icon;
                return (
                  <div className="bf" key={feat.title}>
                    <div className="fi">
                      <Icon className="w-[22px] h-[22px]" />
                    </div>
                    <h3>{feat.title}</h3>
                    <p>{feat.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 0 }} id="bizPlans">
          <div className="wrap">
            <div className="sec-head" style={{ textAlign: "center" }}>
              <div className="eyebrow c" style={{ color: "var(--blue)" }}>
                Pricing
              </div>
              <h2 className="h2-display">PLANS THAT SCALE.</h2>
            </div>

            <div className="plans">
              <div className="plan">
                <h4>Starter</h4>
                <div className="pp">
                  $99<small>/mo</small>
                </div>
                <div className="pd">
                  For small teams shipping 50–200 parcels a month.
                </div>
                <ul>
                  {[
                    "Up to 15% volume discount",
                    "3 team members",
                    "Basic analytics",
                    "Email support",
                  ].map((li) => (
                    <li key={li}>
                      <Check className="w-4 h-4 text-[var(--blue)] shrink-0" />
                      {li}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-block"
                  onClick={() => selectPlan("Starter")}
                >
                  Get Started
                </button>
              </div>

              <div className="plan pop">
                <div className="pb">Most popular</div>
                <h4>Growth</h4>
                <div className="pp">
                  $299<small>/mo</small>
                </div>
                <div className="pd">
                  For scaling businesses shipping 200–1,000 parcels a month.
                </div>
                <ul>
                  {[
                    "Up to 25% volume discount",
                    "Unlimited team members",
                    "Full analytics suite",
                    "Priority 24/7 support",
                    "Bulk CSV upload",
                  ].map((li) => (
                    <li key={li}>
                      <Check className="w-4 h-4 text-[var(--blue)] shrink-0" />
                      {li}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="sw-btn sw-btn-blue sw-btn-block"
                  onClick={() => selectPlan("Growth")}
                >
                  Start Free Trial
                </button>
              </div>

              <div className="plan">
                <h4>Enterprise</h4>
                <div className="pp">Custom</div>
                <div className="pd">
                  For 1,000+ parcels a month with custom SLAs.
                </div>
                <ul>
                  {[
                    "Up to 30% volume discount",
                    "Dedicated account manager",
                    "Custom API integration",
                    "White-label tracking",
                    "Monthly invoicing",
                  ].map((li) => (
                    <li key={li}>
                      <Check className="w-4 h-4 text-[var(--blue)] shrink-0" />
                      {li}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-block"
                  onClick={() => selectPlan("Enterprise")}
                >
                  Contact Sales
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 0 }} id="bizForm">
          <div className="wrap">
            <div className="bform">
              <div>
                <div className="eyebrow" style={{ color: "var(--blue)" }}>
                  Talk to us
                </div>
                <h2 className="h2-display">
                  OPEN A BUSINESS
                  <br />
                  ACCOUNT
                </h2>
                <p className="lead">
                  Tell us about your shipping volume and a logistics specialist
                  will build you a rate card within one business day.
                </p>
                <div className="contact">
                  <div>
                    <Clock className="w-[18px] h-[18px] text-[var(--blue)]" />
                    Response within 1 business day
                  </div>
                  <div>
                    <Shield className="w-[18px] h-[18px] text-[var(--blue)]" />
                    No commitment · cancel any time
                  </div>
                  <div>
                    <Globe className="w-[18px] h-[18px] text-[var(--blue)]" />
                    Offices in Lagos, London, Dubai &amp; Singapore
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <div className="pi">
                    <Building2 className="w-[17px] h-[17px]" />
                  </div>
                  <div>
                    <b>Business enquiry</b>
                    <small>Takes about a minute</small>
                  </div>
                </div>

                {submittedRef ? (
                  <div className="bok">
                    <div className="done" style={{ margin: 0 }}>
                      <div className="tick">
                        <Check className="w-9 h-9" />
                      </div>
                    </div>
                    <h3
                      className="bebas"
                      style={{
                        fontWeight: 400,
                        fontSize: "2.2rem",
                        marginBottom: 8,
                      }}
                    >
                      REQUEST RECEIVED
                    </h3>
                    <p className="lead">
                      Thanks <b style={{ color: "var(--text)" }}>{name}</b> — a
                      specialist will email you within one business day.
                    </p>
                    <div
                      className="code"
                      style={{ color: "var(--blue)", marginTop: 18 }}
                    >
                      {submittedRef}
                    </div>
                    <small
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "var(--faint)",
                        fontWeight: 700,
                      }}
                    >
                      Reference
                    </small>
                  </div>
                ) : (
                  <form className="panel-b" onSubmit={handleSubmit} noValidate>
                    <div className="g2">
                      <div className="fw">
                        <label className="lbl" htmlFor="bCompany">
                          Company
                        </label>
                        <input
                          id="bCompany"
                          className="field"
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          placeholder="Acme Logistics Ltd"
                          required
                        />
                      </div>
                      <div className="fw">
                        <label className="lbl" htmlFor="bName">
                          Your name
                        </label>
                        <input
                          id="bName"
                          className="field"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Adaeze Okafor"
                          required
                        />
                      </div>
                    </div>

                    <div className="fw">
                      <label className="lbl" htmlFor="bEmail">
                        Work email
                      </label>
                      <input
                        id="bEmail"
                        className="field"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                      />
                    </div>

                    <div className="g2">
                      <div className="fw">
                        <label className="lbl" htmlFor="bPlan">
                          Plan
                        </label>
                        <select
                          id="bPlan"
                          className="field"
                          value={plan}
                          onChange={(e) =>
                            setPlan(
                              e.target.value as
                                | "Starter"
                                | "Growth"
                                | "Enterprise"
                            )
                          }
                        >
                          <option value="Starter">Starter</option>
                          <option value="Growth">Growth</option>
                          <option value="Enterprise">Enterprise</option>
                        </select>
                      </div>
                      <div className="fw">
                        <label className="lbl" htmlFor="bVol">
                          Monthly volume
                        </label>
                        <select
                          id="bVol"
                          className="field"
                          value={volume}
                          onChange={(e) => setVolume(e.target.value)}
                        >
                          <option>50 – 200 parcels</option>
                          <option>200 – 1,000 parcels</option>
                          <option>1,000+ parcels</option>
                          <option>Freight / pallets</option>
                        </select>
                      </div>
                    </div>

                    <div className="fw">
                      <label className="lbl" htmlFor="bMsg">
                        What do you ship, and where to?
                      </label>
                      <textarea
                        id="bMsg"
                        className="field"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="e.g. Fashion exports from Lagos to the UK and UAE, ~400 parcels a month"
                      />
                    </div>

                    {error && <div className="au-err">{error}</div>}

                    <button
                      type="submit"
                      disabled={busy}
                      className="sw-btn sw-btn-blue sw-btn-lg sw-btn-block"
                    >
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                      Request Rate Card →
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
