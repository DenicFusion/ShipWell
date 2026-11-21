import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Boxes,
  Building2,
  Check,
  Clock,
  DollarSign,
  FileText,
  Globe,
  Home as HomeIcon,
  MapPin,
  Monitor,
  Package,
  Plane,
  Shield,
  TrendingUp,
  Truck,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { formatTrackingCode } from "@/types/tracking";
import toast from "react-hot-toast";

const TICKER_ITEMS = [
  { code: "SW-20261116-A8F4B2C1", lane: "LOS → LHR", status: "Out for Delivery", tone: "" },
  { code: "SW-20261117-C3D9E102", lane: "ACC → FRA", status: "In Transit · Frankfurt Hub", tone: "b" },
  { code: "SW-20261115-99F01B4A", lane: "DXB → JFK", status: "Customs Cleared", tone: "" },
  { code: "SW-20261118-71C22E8D", lane: "JNB → AMS", status: "Priority Air Dispatched", tone: "b" },
  { code: "SW-20261114-4A198D0C", lane: "BOM → SIN", status: "Delivered · Signed", tone: "" },
  { code: "SW-20261119-E5209F7B", lane: "YYZ → LHR", status: "Courier Collection Scheduled", tone: "a" },
];

const PARTNER_LOGOS = [
  "MERIDIAN TRADE",
  "NOVA RETAIL",
  "AXIOM INDUSTRIAL",
  "KRONOS FREIGHT",
  "ATLAS SUPPLY",
  "VANGUARD EXPORTS",
  "VERTEX COMMERCE",
  "ORBIT LOGISTICS",
];

function AnimatedCounter({
  target,
  suffix = "",
  decimals = 0,
}: {
  target: number;
  suffix?: string;
  decimals?: number;
}) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !ran.current) {
          ran.current = true;
          const start = performance.now();
          const dur = 1400;
          const tick = (now: number) => {
            const p = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(target * eased);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {decimals > 0 ? val.toFixed(decimals) : Math.round(val)}
      {suffix}
    </span>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [trackCode, setTrackCode] = useState("");
  const [shake, setShake] = useState(false);

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = formatTrackingCode(trackCode);
    if (!formatted) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      toast("Enter a ShipWell tracking number (e.g. SW-20260531-A8F4B2C1)");
      return;
    }
    navigate(`/track/${formatted}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="sw-main flex-1">
        {/* HERO */}
        <section className="sw-hero">
          <div className="glow g1" />
          <div className="glow g2" />
          <div className="glow g3" />

          <div className="wrap">
            <div className="sw-badge">
              <i />
              Real-time tracking worldwide
            </div>

            <h1>
              <span className="l l1">THE WORLD&apos;S GOODS.</span>
              <span className="l l2">DELIVERED</span>
              <span className="l l3">WITH PRECISION.</span>
            </h1>

            <p className="lead">
              ShipWell connects businesses and individuals to the world&apos;s
              most reliable logistics network — live tracking, customs handled,
              and white-glove support at every mile.
            </p>

            <form
              className={`tbar ${shake ? "shake" : ""}`}
              onSubmit={handleTrackSubmit}
              noValidate
              autoComplete="off"
            >
              <span className="pin">
                <MapPin className="w-[18px] h-[18px]" />
              </span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={trackCode}
                onChange={(e) => setTrackCode(formatTrackingCode(e.target.value))}
                placeholder="SW-20260531-A8F4B2C1"
                aria-label="Tracking number"
              />
              <button type="submit">TRACK</button>
            </form>

            <div className="thint">
              Tracking numbers are always <b>UPPERCASE</b> · format
              SW-YYYYMMDD-XXXXXXXX
            </div>

            <div className="trust">
              <div className="tb">
                <Shield className="w-3.5 h-3.5 text-[var(--em)]" />
                SSL Encrypted
              </div>
              <div className="tb">
                <Clock className="w-3.5 h-3.5 text-[var(--em)]" />
                24/7 Live Support
              </div>
              <div className="tb">
                <Check className="w-3.5 h-3.5 text-[var(--em)]" />
                ISO 9001 Certified
              </div>
              <div className="tb">
                <Monitor className="w-3.5 h-3.5 text-[var(--em)]" />
                Free Tracking App
              </div>
            </div>

            <div className="live">
              <div className="live-h">
                <div className="live-id">
                  <i />
                  LIVE · SW-20261116-A8F4B2C1
                </div>
                <span className="chip g">Out for delivery</span>
              </div>
              <svg
                className="route"
                viewBox="0 0 600 150"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="rg" x1="0" x2="1">
                    <stop offset="0" stopColor="#10B981" />
                    <stop offset="1" stopColor="#34D399" />
                  </linearGradient>
                </defs>
                <path
                  d="M44 112 C 170 6, 430 6, 556 112"
                  fill="none"
                  stroke="#1E293B"
                  strokeWidth="2.5"
                  className="dash"
                  strokeLinecap="round"
                />
                <path
                  d="M44 112 C 170 6, 430 6, 556 112"
                  fill="none"
                  stroke="url(#rg)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="470 700"
                  style={{ filter: "drop-shadow(0 0 6px rgba(16,185,129,.8))" }}
                />
                <circle
                  cx="44"
                  cy="112"
                  r="7"
                  fill="#07090F"
                  stroke="#10B981"
                  strokeWidth="2.5"
                />
                <circle
                  cx="556"
                  cy="112"
                  r="7"
                  fill="#07090F"
                  stroke="#475569"
                  strokeWidth="2.5"
                />
                <g>
                  <circle r="14" fill="#10B981" opacity=".18">
                    <animateMotion
                      dur="7s"
                      repeatCount="indefinite"
                      path="M44 112 C 170 6, 430 6, 556 112"
                    />
                  </circle>
                  <circle r="6" fill="#34D399">
                    <animateMotion
                      dur="7s"
                      repeatCount="indefinite"
                      path="M44 112 C 170 6, 430 6, 556 112"
                    />
                  </circle>
                </g>
                <text
                  x="44"
                  y="140"
                  fill="#94A3B8"
                  fontSize="13"
                  textAnchor="middle"
                  fontWeight="600"
                >
                  Accra
                </text>
                <text
                  x="556"
                  y="140"
                  fill="#94A3B8"
                  fontSize="13"
                  textAnchor="middle"
                  fontWeight="600"
                >
                  London
                </text>
              </svg>
              <div className="live-f">
                <div>
                  <small>ETA</small>
                  <b>Today · 16:30</b>
                </div>
                <div>
                  <small>Distance</small>
                  <b>5,090 km</b>
                </div>
                <div>
                  <small>Service</small>
                  <b>Express</b>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TICKER */}
        <div className="ticker" aria-hidden="true">
          <div className="tk-track">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, idx) => (
              <div key={idx} className="tk-item">
                <i className={item.tone} />
                <b>{item.code}</b>
                <span>{item.lane}</span>
                <span>· {item.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* QUICK ACTIONS */}
        <div className="wrap">
          <div className="qa">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45 }}
            >
              <Link className="qac" to="/ship">
                <span className="go">
                  <ArrowUpRight className="w-5 h-5" />
                </span>
                <div className="qi">
                  <Truck className="w-[22px] h-[22px]" />
                </div>
                <h3>Ship Now</h3>
                <p>Book a door-to-door collection in under three minutes.</p>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0.08 }}
            >
              <Link className="qac am" to="/quote">
                <span className="go">
                  <ArrowUpRight className="w-5 h-5" />
                </span>
                <div className="qi">
                  <DollarSign className="w-[22px] h-[22px]" />
                </div>
                <h3>Get a Quote</h3>
                <p>Instant pricing for any route, weight and service level.</p>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0.16 }}
            >
              <Link className="qac bl" to="/business-shipping">
                <span className="go">
                  <ArrowUpRight className="w-5 h-5" />
                </span>
                <div className="qi">
                  <Building2 className="w-[22px] h-[22px]" />
                </div>
                <h3>Business Shipping</h3>
                <p>Volume rates, API access and a dedicated account manager.</p>
              </Link>
            </motion.div>
          </div>
        </div>

        {/* SERVICES */}
        <section className="sec" id="services">
          <div className="wrap">
            <div className="sec-head">
              <div className="eyebrow">Our Services</div>
              <h2 className="h2-display">
                EVERY MILE,
                <br />
                COVERED.
              </h2>
              <p
                className="lead"
                style={{ maxWidth: 520, marginTop: 16 }}
              >
                From door-to-door parcels to full-container ocean freight — one
                platform, zero complexity.
              </p>
            </div>

            <div className="sgrid">
              <Link className="sc" to="/quote">
                <div className="num">01</div>
                <div className="si">
                  <Zap className="w-[26px] h-[26px]" />
                </div>
                <h3>Express Delivery</h3>
                <p>
                  Next-day and same-day delivery across 50+ major cities with
                  live courier tracking.
                </p>
                <span className="tag">From 24 hrs</span>
                <span className="more">Get a quote →</span>
              </Link>

              <Link className="sc" to="/quote">
                <div className="num">02</div>
                <div className="si">
                  <Globe className="w-[26px] h-[26px]" />
                </div>
                <h3>International Shipping</h3>
                <p>
                  Reach 180+ countries with full customs documentation, duties
                  calculation and door delivery.
                </p>
                <span className="tag">180+ Countries</span>
                <span className="more">Get a quote →</span>
              </Link>

              <Link className="sc" to="/business-shipping">
                <div className="num">03</div>
                <div className="si">
                  <Boxes className="w-[26px] h-[26px]" />
                </div>
                <h3>Freight &amp; Cargo</h3>
                <p>
                  LCL, FCL, air freight and break-bulk for businesses moving
                  goods at scale.
                </p>
                <span className="tag">Up to 30,000 kg</span>
                <span className="more">Talk to sales →</span>
              </Link>

              <Link className="sc" to="/business-shipping">
                <div className="num">04</div>
                <div className="si">
                  <Shield className="w-[26px] h-[26px]" />
                </div>
                <h3>Customs Brokerage</h3>
                <p>
                  Licensed agents handle classification, tariffs and clearance
                  in 24–72 hours.
                </p>
                <span className="tag">Managed service</span>
                <span className="more">Talk to sales →</span>
              </Link>

              <Link className="sc" to="/ship">
                <div className="num">05</div>
                <div className="si">
                  <MapPin className="w-[26px] h-[26px]" />
                </div>
                <h3>Last-Mile Delivery</h3>
                <p>
                  Dense urban networks with OTP proof of delivery and live route
                  optimisation.
                </p>
                <span className="tag">GPS live</span>
                <span className="more">Ship now →</span>
              </Link>

              <Link className="sc" to="/business-shipping">
                <div className="num">06</div>
                <div className="si">
                  <TrendingUp className="w-[26px] h-[26px]" />
                </div>
                <h3>ShipWell Analytics</h3>
                <p>
                  Cost trends, transit benchmarks, carrier performance and
                  exportable reports.
                </p>
                <span className="tag">Business only</span>
                <span className="more">See plans →</span>
              </Link>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <div className="how-wrap" id="how-it-works">
          <section className="sec">
            <div className="wrap">
              <div className="sec-head" style={{ textAlign: "center" }}>
                <div className="eyebrow c">How It Works</div>
                <h2 className="h2-display">
                  FOUR STEPS.
                  <br />
                  ONE PLATFORM.
                </h2>
              </div>

              <div className="how">
                <div className="hs">
                  <div className="hc">
                    <FileText className="w-[30px] h-[30px]" />
                  </div>
                  <small>Step 01</small>
                  <h3>Book Online</h3>
                  <p>
                    Enter parcel details, pick a service and pay securely in
                    minutes.
                  </p>
                </div>

                <div className="hs">
                  <div className="hc">
                    <HomeIcon className="w-[30px] h-[30px]" />
                  </div>
                  <small>Step 02</small>
                  <h3>We Collect</h3>
                  <p>
                    A ShipWell courier arrives at your door at the time you
                    choose.
                  </p>
                </div>

                <div className="hs">
                  <div className="hc">
                    <Plane className="w-[30px] h-[30px]" />
                  </div>
                  <small>Step 03</small>
                  <h3>We Ship</h3>
                  <p>
                    Sorted, dispatched and scanned at every checkpoint, live.
                  </p>
                </div>

                <div className="hs">
                  <div className="hc">
                    <Check className="w-[30px] h-[30px]" />
                  </div>
                  <small>Step 04</small>
                  <h3>Delivered</h3>
                  <p>Recipient is notified and you receive proof of delivery.</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* STATS BAR */}
        <div className="stats">
          <div className="wrap">
            <div className="sgrid4">
              <div className="st">
                <b>
                  <AnimatedCounter target={200} suffix="M+" />
                </b>
                <span>Packages Delivered</span>
              </div>
              <div className="st">
                <b>
                  <AnimatedCounter target={180} suffix="+" />
                </b>
                <span>Countries Covered</span>
              </div>
              <div className="st">
                <b>
                  <AnimatedCounter target={99.98} decimals={2} suffix="%" />
                </b>
                <span>On-Time Delivery</span>
              </div>
              <div className="st">
                <b>24/7</b>
                <span>Live Support</span>
              </div>
            </div>
          </div>
        </div>

        {/* ONE SHIPMENT TWO DASHBOARDS */}
        <section className="sec" id="two-sides" style={{ paddingTop: "clamp(64px,10vw,96px)" }}>
          <div className="wrap">
            <div className="sec-head" style={{ textAlign: "center" }}>
              <div className="eyebrow c">Sender &amp; Receiver</div>
              <h2 className="h2-display">
                ONE SHIPMENT.
                <br />
                TWO DASHBOARDS.
              </h2>
              <p
                className="lead"
                style={{ maxWidth: 540, margin: "16px auto 0" }}
              >
                Everyone involved follows the same live journey — with the item
                photos, alerts and next steps that matter to them.
              </p>
            </div>
            <div className="qa" style={{ padding: 0 }}>
              <div className="qac">
                <div className="qi">
                  <Package className="w-[22px] h-[22px]" />
                </div>
                <h3>1 · Sender books &amp; uploads photos</h3>
                <p>
                  Add the parcel details, photos of the item and the
                  receiver&apos;s email. ShipWell reviews it before it moves.
                </p>
              </div>
              <div className="qac">
                <div className="qi">
                  <FileText className="w-[22px] h-[22px]" />
                </div>
                <h3>2 · Receiver signs up</h3>
                <p>
                  The moment they register with that same email, the parcel is
                  linked to their account automatically.
                </p>
              </div>
              <div className="qac">
                <div className="qi">
                  <HomeIcon className="w-[22px] h-[22px]" />
                </div>
                <h3>3 · &ldquo;On Its Way To You&rdquo;</h3>
                <p>
                  It appears on their dashboard with the sender&apos;s photos,
                  live checkpoints and any action we need from them.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="sec" id="testimonials" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head" style={{ textAlign: "center" }}>
              <div className="eyebrow c">Customer Stories</div>
              <h2 className="h2-display">TRUSTED BY THOUSANDS.</h2>
            </div>

            <div className="tgrid">
              <div className="tc">
                <div className="q">&ldquo;</div>
                <div className="stars">★★★★★</div>
                <p>
                  We moved our whole import line to ShipWell in a quarter.
                  Tracking is genuinely live — not vague status messages — and
                  customs clearance is down to a day.
                </p>
                <div className="who">
                  <div className="av">JM</div>
                  <div>
                    <b>James Mensah</b>
                    <small>Head of Imports · Meridian Trade, Accra</small>
                  </div>
                </div>
              </div>

              <div className="tc">
                <div className="q">&ldquo;</div>
                <div className="stars">★★★★★</div>
                <p>
                  200+ shipments a month from one dashboard. The bulk CSV upload
                  alone saves my team three hours every week, and invoices
                  arrive in one clean statement.
                </p>
                <div className="who">
                  <div className="av">SO</div>
                  <div>
                    <b>Sarah Okonkwo</b>
                    <small>E-commerce Director · Nova Retail, Lagos</small>
                  </div>
                </div>
              </div>

              <div className="tc">
                <div className="q">&ldquo;</div>
                <div className="stars">★★★★★</div>
                <p>
                  Their brokerage team handled documentation, duties and
                  clearance while I watched the timeline update from my desk.
                  Zero surprises, exactly as promised.
                </p>
                <div className="who">
                  <div className="av">RK</div>
                  <div>
                    <b>Ravi Kumar</b>
                    <small>Operations Lead · Axiom Industrial, Mumbai</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* BUSINESS CTA */}
        <div
          className="wrap"
          style={{ paddingBottom: "clamp(64px,9vw,100px)" }}
        >
          <div className="bcta">
            <div>
              <div className="eyebrow">For Business</div>
              <h2 className="h2-display">
                SHIPPING 50+ PARCELS
                <br />A MONTH? <em>SHIP SMARTER.</em>
              </h2>
              <ul className="perks">
                {[
                  "Up to 30% off standard rates",
                  "Dedicated account manager",
                  "Bulk CSV upload & API access",
                  "Monthly consolidated invoicing",
                  "Priority customs clearance",
                ].map((perk) => (
                  <li key={perk}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "rgba(16,185,129,0.12)",
                        border: "1px solid rgba(16,185,129,0.3)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--em)",
                        flexShrink: 0,
                      }}
                    >
                      <Check className="w-3 h-3" />
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>
              <Link
                className="sw-btn sw-btn-em sw-btn-lg"
                to="/business-shipping"
              >
                Explore Business Shipping →
              </Link>
            </div>

            <div className="dm">
              <div className="dm-h">
                <b>Business Dashboard · Nov 2026</b>
                <span className="chip g">Live</span>
              </div>
              <div className="kpis">
                <div className="kpi">
                  <b>847</b>
                  <small>Shipments this month</small>
                  <em>↑ 14% vs Oct</em>
                </div>
                <div className="kpi">
                  <b>$12.4K</b>
                  <small>Savings applied</small>
                  <em>22% volume rate</em>
                </div>
                <div className="kpi">
                  <b>99.2%</b>
                  <small>On-time rate</small>
                  <em>Excellent</em>
                </div>
                <div className="kpi">
                  <b>38</b>
                  <small>Customs cleared</small>
                  <em>Avg. 19 hrs</em>
                </div>
              </div>
              <div className="bars">
                <h6>Volume by region</h6>
                {[
                  { label: "Africa", pct: "72%" },
                  { label: "Europe", pct: "55%" },
                  { label: "Asia", pct: "38%" },
                  { label: "Americas", pct: "24%" },
                ].map((row) => (
                  <div className="bar" key={row.label}>
                    <span>{row.label}</span>
                    <div className="t">
                      <i style={{ width: row.pct }} />
                    </div>
                    <span>{row.pct}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* PARTNER LOGOS */}
        <div className="logos">
          <h6>Trusted by global businesses shipping with ShipWell</h6>
          <div className="lg-track">
            {[...PARTNER_LOGOS, ...PARTNER_LOGOS].map((logo, idx) => (
              <span key={idx}>{logo}</span>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
