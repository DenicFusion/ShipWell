'use client';

import { ShipwellLogo } from "@/components/ShipwellLogo"
import { ThemeSwitch } from "@/components/ThemeSwitch"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { auth, db } from "@/lib/firebase"
import { onAuthStateChanged, User } from "firebase/auth"
import { doc, getDoc, setDoc, serverTimestamp, collection } from "firebase/firestore"
import { 
  ArrowRight, 
  Search, 
  Truck, 
  DollarSign, 
  Building2, 
  ChevronRight, 
  Star, 
  Zap, 
  Clock, 
  MapPin, 
  Globe, 
  FileText, 
  Check, 
  Loader2, 
  ShieldCheck, 
  Menu, 
  X, 
  Building,
  Activity,
  ArrowDown,
  Info,
  Package,
  Terminal,
  Clipboard,
  FileSpreadsheet,
  Keyboard,
  UploadCloud,
  Code,
  Database,
  ChevronDown,
  Calendar
} from "lucide-react"

import { calculateQuote } from "@/lib/quote-engine"

export default function HomePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [trackingId, setTrackingId] = useState("")
  const [loading, setLoading] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Quick Quote Estimator states
  const [quoteOrigin, setQuoteOrigin] = useState("Accra")
  const [quoteDestination, setQuoteDestination] = useState("London")
  const [quoteWeight, setQuoteWeight] = useState("5")
  const [quoteService, setQuoteService] = useState("express")
  const [quoteResult, setQuoteResult] = useState<number | null>(null)
  const [quoteDays, setQuoteDays] = useState<string | null>(null)
  const [quoteBreakdown, setQuoteBreakdown] = useState<any>(null)

  // Booking Modal
  const [bookingModalOpen, setBookingModalOpen] = useState(false)
  const [senderName, setSenderName] = useState("")
  const [receiverName, setReceiverName] = useState("")
  const [pkgDesc, setPkgDesc] = useState("")
  const [estimatedCost, setEstimatedCost] = useState<number>(45)
  const [bookingSuccessId, setBookingSuccessId] = useState<string | null>(null)

  // Business Saved State Increments
  const [savedAmount, setSavedAmount] = useState(12450)
  const [shipmentCount, setShipmentCount] = useState(847)

  // Floating Dropdown Mega-Menu States
  const [activeHeaderTab, setActiveHeaderTab] = useState<'track' | 'ship' | 'services' | 'business' | null>(null);
  
  // Search history list from localStorage for tracking tab
  const [searchedTrackingIds, setSearchedTrackingIds] = useState<string[]>([]);
  
  // Custom interactive popup modal states
  const [multiTrackerOpen, setMultiTrackerOpen] = useState(false);
  const [multiTrackingInput, setMultiTrackingInput] = useState("");
  const [multiTrackingResults, setMultiTrackingResults] = useState<{id: string, found: boolean, status?: string, origin?: string, destination?: string}[]>([]);
  const [shakeTrack, setShakeTrack] = useState(false);
  const [multiTrackingLoading, setMultiTrackingLoading] = useState(false);
  
  const [pickupModalOpen, setPickupModalOpen] = useState(false);
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("morning");
  const [pickupSpeed, setPickupSpeed] = useState("express");
  const [pickupSuccess, setPickupSuccess] = useState<string | null>(null);
  const [pickupSubmitting, setPickupSubmitting] = useState(false);

  const [volumetricModalOpen, setVolumetricModalOpen] = useState(false);
  const [volumeLength, setVolumeLength] = useState("30");
  const [volumeWidth, setVolumeWidth] = useState("20");
  const [volumeHeight, setVolumeHeight] = useState("15");
  const [volumeWeight, setVolumeWeight] = useState("5");
  const [volumeResult, setVolumeResult] = useState<{volumetricWeight: number, billableWeight: number, isVolumetric: boolean} | null>(null);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCsvInput, setBulkCsvInput] = useState("");
  const [bulkResults, setBulkResults] = useState<any[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [devApiOpen, setDevApiOpen] = useState(false);
  const [devApiLang, setDevApiLang] = useState<'curl' | 'js' | 'python'>('curl');

  const [serviceOverlayDetail, setServiceOverlayDetail] = useState<string | null>(null);

  // Load search history from localStorage
  useEffect(() => {
    setLoading(false);
    try {
      const stored = localStorage.getItem("shipwell_search_history");
      if (stored) {
        setSearchedTrackingIds(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Localstorage read error", e);
    }
  }, []);

  const addToSearchHistory = (id: string) => {
    const cleaned = id.trim().toUpperCase();
    if (!cleaned) return;
    try {
      const history = [cleaned, ...searchedTrackingIds.filter(x => x !== cleaned)].slice(0, 5);
      setSearchedTrackingIds(history);
      localStorage.setItem("shipwell_search_history", JSON.stringify(history));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
    })
    return unsub
  }, [])

  // Dynamic values increment simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setSavedAmount(prev => prev + Math.floor(Math.random() * 3) + 1)
      if (Math.random() > 0.7) {
        setShipmentCount(prev => prev + 1)
      }
    }, 4500)
    return () => clearInterval(interval)
  }, [])

  // Auto calculate quote when variables change
  useEffect(() => {
    const weightNum = parseFloat(quoteWeight) || 0;
    if (weightNum > 0) {
      // Map service for calculateQuote since select values are different
      const svcMap: Record<string, string> = {
        economy: "Economy (5-7d)",
        express: "Express (1-2d)",
        sameday: "Same-Day",
        freight: "Freight"
      };
      const result = calculateQuote({
        originCountry: quoteOrigin,
        destinationCountry: quoteDestination,
        weightKg: weightNum,
        serviceType: svcMap[quoteService] || "Express (1-2d)",
      });
      setQuoteResult(result.total);
      setQuoteDays(result.estimatedDays);
      setQuoteBreakdown(result);
    } else {
      setQuoteResult(0);
      setQuoteDays(null);
      setQuoteBreakdown(null);
    }
  }, [quoteOrigin, quoteDestination, quoteWeight, quoteService])

  const handleTrackSubmit = (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault()
    if (!trackingId.trim()) {
      alert("No code inside. Please enter a valid tracking number.");
      setShakeTrack(true);
      setTimeout(() => setShakeTrack(false), 500);
      return;
    }
    setLoading(true)
    const tid = trackingId.trim().toUpperCase()
    addToSearchHistory(tid)
    router.push(`/track/${tid}`)
  }

  const handlePreFill = (code: string) => {
    setTrackingId(code)
    addToSearchHistory(code)
  }

  const handleInitiateBooking = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const randomHex = Math.floor(Math.random() * 1000000).toString(16).toUpperCase()
    const generatedCode = `SW-2026-${randomHex}`
    
    try {
      if (user) {
        // Logged-in user booking (writes directly to live database!)
        const shipmentRef = doc(db, "shipments", generatedCode)
        const shipmentPayload = {
          userId: user.uid,
          status: "PENDING",
          carrier: "Shipwell Express",
          trackingNumber: generatedCode,
          originCity: "Accra",
          originState: "GH",
          originZip: "00233",
          destinationCity: "London",
          destinationState: "UK",
          destinationZip: "EC1A 1bb",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
        await setDoc(shipmentRef, shipmentPayload)

        // Create timeline event under shipments/{generatedCode}/events/...
        const timelineRef = doc(collection(db, `shipments/${generatedCode}/events`))
        await setDoc(timelineRef, {
          isLogical: false,
          isLatest: true,
          statusColor: "bg-emerald-500",
          eventCode: "PENDING",
          label: "Shipment registered successfully",
          description: `The sender (${senderName}) scheduled a digital shipping label for delivery to ${receiverName}.`,
          facility: "Accra Cargo Gateway",
          location: "Accra, GH",
          formattedDate: "Today",
          formattedTime: "Just Now",
          createdAt: serverTimestamp()
        })
      } else {
        // Guest user booking assignment (saves custom detail locally in browser storage)
        const guestBooking = {
          status: "PENDING",
          carrier: "Shipwell Guest Logistics",
          trackingNumber: generatedCode,
          origin: { city: "Accra", state: "GH", zip: "00233" },
          destination: { city: "London", state: "UK", zip: "EC1A 1BB" },
          events: [
            {
              id: "evt-init",
              isLogical: false,
              isLatest: true,
              statusColor: "bg-amber-500",
              eventCode: "PENDING",
              label: "Guest digital invoice created",
              description: `A simulated guest ticket was generated. ${senderName} registered a delivery node to ${receiverName} (${pkgDesc}).`,
              location: "Local Browser Session",
              formattedDate: "Today",
              formattedTime: "Just Now"
            }
          ]
        }
        try {
          localStorage.setItem(`shipwell_guest_tracking_${generatedCode}`, JSON.stringify(guestBooking))
        } catch (e) {
          console.error(e)
        }
      }
      setBookingSuccessId(generatedCode)
      addToSearchHistory(generatedCode)
    } catch (err) {
      console.error("Booking error:", err)
      alert("Error scheduling shipment. Please ensure you have configured database access.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-bg-base text-text-base transition-colors duration-300 relative font-sans overflow-x-hidden selection:bg-brand-primary selection:text-white">
      
      {/* ─── NAVIGATION ─── */}
      <nav id="navbar" className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 h-[72px] bg-bg-base/85 backdrop-blur-xl border-b border-border-line/60 transition-all duration-300">
        <Link href="/" className="flex items-center gap-2 group decoration-transparent">
          <div className="w-[38px] h-[38px] rounded-lg bg-emerald-950/20 dark:bg-emerald-900/40 border border-brand-primary/30 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Truck className="w-[20px] h-[20px] text-brand-primary" />
          </div>
          <div className="flex flex-col">
            <span className="font-display font-extrabold text-[20px] text-text-base tracking-tight leading-none">Shipwell</span>
            <span className="text-[9px] font-semibold tracking-widest uppercase text-brand-primary mt-[2px] leading-none">
              Track · Deliver · Repeat
            </span>
          </div>
        </Link>

        {/* Desktop Links with Active Stateful Mega-dropdowns */}
        <ul className="hidden lg:flex items-center gap-1 list-none m-0 p-0 animate-fade-in relative z-50">
          <li 
            onMouseEnter={() => setActiveHeaderTab('track')}
            onMouseLeave={() => setActiveHeaderTab(null)}
            className="relative py-2"
          >
            <button 
              onClick={() => setActiveHeaderTab(activeHeaderTab === 'track' ? null : 'track')}
              className="bg-transparent border-none text-text-muted hover:text-text-base text-sm font-medium px-4 py-2 rounded-lg hover:bg-bg-card/40 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>Track</span>
              <ChevronDown className={`w-3.5 h-3.5 transform transition-transform duration-200 ${activeHeaderTab === 'track' ? 'rotate-180 text-brand-primary' : 'rotate-0'}`} />
            </button>
            
            {activeHeaderTab === 'track' && (
              <div 
                className="absolute top-11 left-0 mt-1 w-80 bg-bg-surface border border-border-line rounded-2xl p-5 shadow-2xl animate-scale-up z-[100] flex flex-col gap-4 text-left"
              >
                <div className="flex flex-col gap-1 pb-2 border-b border-border-line/45">
                  <span className="text-[11px] font-bold text-brand-primary uppercase tracking-widest font-mono">Precision Tracking</span>
                  <span className="text-[9px] text-text-muted">Direct real-time cargo status queries</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button 
                    onClick={() => {
                      const el = document.getElementById("track");
                      el?.scrollIntoView({ behavior: 'smooth' });
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <Search className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Track Single Shipment</span>
                      <span className="text-[10px] text-text-muted text-left">Enter SW tracking reference</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      setMultiTrackerOpen(true);
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <Activity className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Multi-Package Tracking</span>
                      <span className="text-[10px] text-text-muted text-left">Trace bulk cargos concurrently</span>
                    </div>
                  </button>
                </div>

                {searchedTrackingIds.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-border-line/45 pt-3">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Recent Searches</span>
                    <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                      {searchedTrackingIds.map((sid) => (
                        <button
                          key={sid}
                          onClick={() => {
                            setTrackingId(sid);
                            router.push(`/track/${sid}`);
                            setActiveHeaderTab(null);
                          }}
                          className="flex items-center justify-between text-xs font-mono font-bold text-brand-primary hover:underline bg-transparent border-none p-1.5 rounded hover:bg-brand-primary/5 cursor-pointer text-left w-full"
                        >
                          <span>{sid}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-brand-primary" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>

          <li 
            onMouseEnter={() => setActiveHeaderTab('ship')}
            onMouseLeave={() => setActiveHeaderTab(null)}
            className="relative py-2"
          >
            <button 
              onClick={() => setActiveHeaderTab(activeHeaderTab === 'ship' ? null : 'ship')}
              className="bg-transparent border-none text-text-muted hover:text-text-base text-sm font-medium px-4 py-2 rounded-lg hover:bg-bg-card/40 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>Ship</span>
              <ChevronDown className={`w-3.5 h-3.5 transform transition-transform duration-250 ${activeHeaderTab === 'ship' ? 'rotate-180 text-brand-primary' : 'rotate-0'}`} />
            </button>
            
            {activeHeaderTab === 'ship' && (
              <div 
                className="absolute top-11 left-0 mt-1 w-80 bg-bg-surface border border-border-line rounded-2xl p-5 shadow-2xl animate-scale-up z-[100] flex flex-col gap-3 text-left"
              >
                <div className="flex flex-col gap-1 pb-2 border-b border-border-line/45">
                  <span className="text-[11px] font-bold text-brand-primary uppercase tracking-widest font-mono">Dispatch Workspace</span>
                  <span className="text-[9px] text-text-muted font-sans font-medium">Manage global freight requests</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button 
                    onClick={() => {
                      setBookingSuccessId(null);
                      setBookingModalOpen(true);
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <Truck className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Ship Now (Live Wizard)</span>
                      <span className="text-[10px] text-text-muted text-left">Generate certified courier label</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      const el = document.getElementById("quote-section") || document.getElementById("track");
                      el?.scrollIntoView({ behavior: 'smooth' });
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <DollarSign className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Get an Instant Quote</span>
                      <span className="text-[10px] text-text-muted text-left">Estimate lane transits & charges</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      setPickupSuccess(null);
                      setPickupModalOpen(true);
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <Calendar className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Schedule Courier Pickup</span>
                      <span className="text-[10px] text-text-muted text-left">Book doorstep package collection</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      setVolumeResult(null);
                      setVolumetricModalOpen(true);
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <FileText className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Volumetric Weight Analyzer</span>
                      <span className="text-[10px] text-text-muted text-left">Analyze cargo dimensional charges</span>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </li>

          <li 
            onMouseEnter={() => setActiveHeaderTab('services')}
            onMouseLeave={() => setActiveHeaderTab(null)}
            className="relative py-2"
          >
            <button 
              onClick={() => setActiveHeaderTab(activeHeaderTab === 'services' ? null : 'services')}
              className="bg-transparent border-none text-text-muted hover:text-text-base text-sm font-medium px-4 py-2 rounded-lg hover:bg-bg-card/40 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>Services</span>
              <ChevronDown className={`w-3.5 h-3.5 transform transition-transform duration-250 ${activeHeaderTab === 'services' ? 'rotate-180 text-brand-primary' : 'rotate-0'}`} />
            </button>
            
            {activeHeaderTab === 'services' && (
              <div 
                className="absolute top-11 -left-12 mt-1 w-96 bg-bg-surface border border-border-line rounded-2xl p-5 shadow-2xl animate-scale-up z-[100] flex flex-col gap-3 text-left"
              >
                <div className="flex flex-col gap-1 pb-2 border-b border-border-line/45">
                  <span className="text-[11px] font-bold text-brand-primary uppercase tracking-widest font-mono font-bold">Standard Services</span>
                  <span className="text-[9px] text-text-muted font-sans font-medium">Premium global route configurations</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'express', name: 'Express Lane', desc: 'Overnight priority air lanes' },
                    { id: 'economy', name: 'Economy Standard', desc: 'Secure cost-effective cargo' },
                    { id: 'sameday', name: 'Same-Day Courier', desc: 'Instant local node couriers' },
                    { id: 'freight', name: 'Heavy Freight', desc: 'LCL and FCL global transport' },
                    { id: 'intl', name: 'Global Jet', desc: 'Border-to-border custom routes' },
                    { id: 'customs', name: 'Customs Clearances', desc: 'Secure legal compliance filings' }
                  ].map((srv) => (
                    <button 
                      key={srv.id}
                      onClick={() => {
                        setServiceOverlayDetail(srv.id);
                        setActiveHeaderTab(null);
                      }}
                      className="p-2.5 border border-border-line/60 rounded-xl hover:bg-bg-base transition-all text-left bg-transparent cursor-pointer flex flex-col gap-1 w-full"
                    >
                      <span className="text-xs font-bold text-text-base flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                        {srv.name}
                      </span>
                      <span className="text-[10px] text-text-muted leading-tight text-left">{srv.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="bg-brand-primary/5 p-2 rounded-xl text-center border border-brand-primary/10 mt-1">
                  <button 
                    onClick={() => {
                      const el = document.getElementById("services");
                      el?.scrollIntoView({ behavior: 'smooth' });
                      setActiveHeaderTab(null);
                    }}
                    className="text-[10px] font-bold text-brand-primary hover:underline bg-transparent border-none cursor-pointer w-full text-center"
                  >
                    View global lanes specifications &rarr;
                  </button>
                </div>
              </div>
            )}
          </li>

          <li 
            onMouseEnter={() => setActiveHeaderTab('business')}
            onMouseLeave={() => setActiveHeaderTab(null)}
            className="relative py-2"
          >
            <button 
              onClick={() => setActiveHeaderTab(activeHeaderTab === 'business' ? null : 'business')}
              className="bg-transparent border-none text-text-muted hover:text-text-base text-sm font-medium px-4 py-2 rounded-lg hover:bg-bg-card/40 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>Business</span>
              <ChevronDown className={`w-3.5 h-3.5 transform transition-transform duration-250 ${activeHeaderTab === 'business' ? 'rotate-180 text-brand-primary' : 'rotate-0'}`} />
            </button>
            
            {activeHeaderTab === 'business' && (
              <div 
                className="absolute top-11 -left-20 mt-1 w-80 bg-bg-surface border border-border-line rounded-2xl p-5 shadow-2xl animate-scale-up z-[100] flex flex-col gap-3 text-left"
              >
                <div className="flex flex-col gap-1 pb-2 border-b border-border-line/45">
                  <span className="text-[11px] font-bold text-brand-primary uppercase tracking-widest font-mono">Enterprise Node</span>
                  <span className="text-[9px] text-text-muted font-sans font-medium">B2B supply-chain architecture</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button 
                    onClick={() => {
                      const el = document.getElementById("business") || document.getElementById("services");
                      el?.scrollIntoView({ behavior: 'smooth' });
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <Building className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Business Account Suite</span>
                      <span className="text-[10px] text-text-muted text-left">30% bulk cargo pricing discounts</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      setBulkResults([]);
                      setBulkCsvInput("");
                      setBulkModalOpen(true);
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Bulk Shipments (CSV Parser)</span>
                      <span className="text-[10px] text-text-muted text-left">Process bulk assignments instantly</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      setDevApiLang('curl');
                      setDevApiOpen(true);
                      setActiveHeaderTab(null);
                    }}
                    className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-bg-base transition-colors text-left bg-transparent border-none cursor-pointer w-full"
                  >
                    <Terminal className="w-4 h-4 text-brand-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-base">Developer API Terminal</span>
                      <span className="text-[10px] text-text-muted text-left">Integrate digital shipment webhooks</span>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </li>

          <li>
            <Link href="/dashboard" className="text-text-muted hover:text-text-base text-sm font-semibold px-4 py-2 rounded-lg hover:bg-bg-card/40 transition-colors flex items-center gap-1 text-brand-primary decoration-transparent">
              <Package className="w-4 h-4 text-brand-primary" /> Dashboard
            </Link>
          </li>
          <li>
            <Link href="/admin" className="text-text-muted hover:text-text-base text-sm font-semibold px-4 py-2 rounded-lg hover:bg-bg-card/40 transition-colors flex items-center gap-1.5 text-text-muted decoration-transparent font-mono">
              <ShieldCheck className="w-4 h-4" /> Admin
            </Link>
          </li>
        </ul>

        {/* Action Buttons */}
        <div className="hidden sm:flex items-center gap-4">
          <ThemeSwitch />
          {user ? (
            <Link href={user.email === "denic9426@gmail.com" || user.email === "admin@shipwell.com" ? "/admin" : "/dashboard"} className="px-[16px] py-[8px] bg-bg-card border border-border-line text-text-base rounded-lg text-sm font-semibold hover:border-brand-primary transition-all flex items-center gap-2 decoration-transparent">
              <div className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-ping" />
              <span>Workspace Active</span>
            </Link>
          ) : (
            <Link href="/auth/login" className="bg-brand-primary hover:bg-brand-primary-hover border-none text-white px-5 py-[9px] rounded-lg text-sm font-semibold cursor-pointer transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_18px_rgba(16,185,129,0.3)] shadow duration-200 decoration-transparent">
              Client login
            </Link>
          )}
        </div>

        {/* Mobile menu trigger */}
        <div className="flex lg:hidden items-center gap-3">
          <ThemeSwitch />
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`p-2 border border-border-line rounded-lg transition-colors ${mobileMenuOpen ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-muted hover:text-text-base hover:bg-bg-card'}`}
          >
            {mobileMenuOpen ? <X className="w-5 h-5 animate-scale-up" /> : <Menu className="w-5 h-5 animate-pulse-dot" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed top-[72px] left-0 right-0 z-[100] bg-bg-surface border-b border-border-line px-6 py-6 flex flex-col gap-5 shadow-2xl animate-fade-in max-h-[calc(100vh-72px)] overflow-y-auto w-full">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest font-mono border-b border-border-line/45 pb-1 block">Precision Tracking</span>
            <a href="#track" onClick={() => setMobileMenuOpen(false)} className="text-text-base text-sm font-medium py-2 flex items-center gap-2"><Search className="w-4 h-4 text-brand-primary" /> Track Shipments</a>
          </div>
          
          <div className="flex flex-col gap-2 mt-2">
            <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest font-mono border-b border-border-line/45 pb-1 block">Dispatch Workspace</span>
            <button onClick={() => { setBookingModalOpen(true); setMobileMenuOpen(false); }} className="text-text-base text-sm font-medium py-2 flex text-left items-center gap-2 bg-transparent border-none p-0 cursor-pointer w-full"><Truck className="w-4 h-4 text-brand-primary" /> Ship Now (Live Wizard)</button>
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest font-mono border-b border-border-line/45 pb-1 block">Global Services</span>
            <a href="#services" onClick={() => setMobileMenuOpen(false)} className="text-text-base text-sm font-medium py-2 flex items-center gap-2"><ArrowDown className="w-4 h-4 text-brand-primary" /> View full service catalog</a>
          </div>

          <div className="flex flex-col gap-2 mt-2 bg-bg-card p-4 rounded-xl border border-border-line">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest font-mono block mb-1">Portals</span>
            <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="text-text-base hover:text-brand-primary font-bold text-sm py-1.5 flex items-center gap-2 decoration-transparent col-span-1">
              <Package className="w-4 h-4 text-text-muted" /> Customer Dashboard
            </Link>
            <Link href="/admin" onClick={() => setMobileMenuOpen(false)} className="text-text-base hover:text-brand-primary font-bold text-sm py-1.5 flex items-center gap-2 decoration-transparent col-span-1">
              <ShieldCheck className="w-4 h-4 text-text-muted" /> Admin Panel
            </Link>
          </div>
          {user ? (
            <Link href={user.email === "denic9426@gmail.com" || user.email === "admin@shipwell.com" ? "/admin" : "/dashboard"} onClick={() => setMobileMenuOpen(false)} className="mt-4 text-center bg-bg-card border border-border-line text-text-base px-5 py-3 rounded-xl font-bold decoration-transparent">
              Access My Workspace
            </Link>
          ) : (
            <Link href="/auth/login" onClick={() => setMobileMenuOpen(false)} className="mt-4 text-center bg-brand-primary text-white px-5 py-3 rounded-xl font-bold decoration-transparent">
              Get Started (Login)
            </Link>
          )}
        </div>
      )}

      {/* ─── HERO SECTION ─── */}
      <section id="track" className="min-h-screen relative flex flex-col items-center justify-center px-4 sm:px-6 md:px-12 py-32 overflow-hidden text-center">
        {/* dot grid overlay */}
        <div className="absolute inset-0 dot-grid opacity-[0.3] dark:opacity-[0.5] pointer-events-none" />

        {/* emerald glow blob */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] sm:w-[680px] h-[340px] sm:h-[500px] bg-brand-primary/10 rounded-full blur-[90px] animate-breathe pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto flex flex-col items-center gap-6 mt-10">
          
          {/* Top Badge */}
          <div className="inline-flex items-center gap-2.5 bg-brand-primary/10 hover:bg-brand-primary/15 border border-brand-primary/20 dark:border-brand-primary/30 rounded-full py-1.5 pl-3.5 pr-4 text-xs font-semibold text-brand-primary transition-all duration-300">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-pulse-dot" />
            Real-time tracking · 180+ countries · Zero surprises
          </div>

          {/* Heading */}
          <h1 className="font-display font-[800] text-[40px] sm:text-[68px] md:text-[98px] leading-[0.9] tracking-tight uppercase max-w-5xl m-0 select-none">
            <span className="block text-text-base animate-fade-in-up">THE WORLD&apos;S GOODS.</span>
            <span className="block text-brand-primary mt-2">DELIVERED</span>
            <span className="block text-text-muted mt-2">WITH PRECISION.</span>
          </h1>

          {/* Subtitle */}
          <p className="text-text-muted text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mt-4">
            Ship anything, track everything, deliver on time. Shipwell is the high-precision logistics platform built for businesses and individuals who can&apos;t afford to wait.
          </p>

            <div className={`w-full max-w-[580px] mt-8 ${shakeTrack ? 'animate-wiggle' : ''}`}>
              <div className="flex flex-col sm:flex-row gap-3 p-2 bg-bg-card border border-border-line rounded-xl sm:rounded-2xl shadow-[0_12px_45px_rgba(0,0,0,0.15)] focus-within:border-brand-primary focus-within:ring-4 focus-within:ring-brand-primary/10 transition-all duration-300">
                <div className="flex-1 flex items-center gap-2 px-3">
                  <Search className="w-5 h-5 text-text-muted shrink-0" />
                  <input
                    type="text"
                    value={trackingId}
                    onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleTrackSubmit(e);
                    }}
                    placeholder="Enter tracking number e.g. SW-20260530-ACC001"
                    className="w-full bg-transparent border-none text-base text-text-base font-mono focus:outline-none placeholder:text-text-muted/60 py-3 uppercase"
                  />
                </div>
                <button
                  onClick={handleTrackSubmit}
                  disabled={loading}
                  className="bg-brand-primary hover:bg-brand-primary-hover text-white font-display text-sm font-bold uppercase tracking-wider py-3.5 px-8 rounded-xl shrink-0 transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : null}
                  <span>TRACK</span>
                </button>
              </div>

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-4 text-[12px] text-text-muted">
              <span>Demo Shipments:</span>
              <button onClick={() => handlePreFill("SW-DEMO-001")} className="font-mono text-brand-primary hover:underline font-bold bg-transparent border-none cursor-pointer p-0">SW-DEMO-001</button>
              <button onClick={() => handlePreFill("SW-2026-X8Y1")} className="font-mono text-brand-primary hover:underline font-bold bg-transparent border-none cursor-pointer p-0">SW-2026-X8Y1</button>
              <Link href="/admin" className="text-brand-primary hover:underline font-semibold flex items-center gap-1">Add own sample codes in admin <ArrowRight className="w-3 h-3" /></Link>
            </div>
          </div>

          {/* Trust Pills */}
          <div className="flex flex-wrap justify-center items-center gap-3 mt-12">
            <div className="flex items-center gap-1.5 bg-bg-card/60 backdrop-blur-sm border border-border-line px-4 py-2 rounded-full text-xs font-medium text-text-muted">
              <Check className="w-3.5 h-3.5 text-brand-primary" /> No hidden fees
            </div>
            <div className="flex items-center gap-1.5 bg-bg-card/60 backdrop-blur-sm border border-border-line px-4 py-2 rounded-full text-xs font-medium text-text-muted">
              <Check className="w-3.5 h-3.5 text-brand-primary" /> 180+ countries covered
            </div>
            <div className="flex items-center gap-1.5 bg-bg-card/60 backdrop-blur-sm border border-border-line px-4 py-2 rounded-full text-xs font-medium text-text-muted">
              <Check className="w-3.5 h-3.5 text-brand-primary" /> 99.98% on-time delivery
            </div>
            <div className="flex items-center gap-1.5 bg-bg-card/60 backdrop-blur-sm border border-border-line px-4 py-2 rounded-full text-xs font-medium text-text-muted">
              <Check className="w-3.5 h-3.5 text-brand-primary" /> 24/7 dedicated support
            </div>
          </div>

        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-text-muted/60 text-[11px] font-semibold uppercase tracking-[0.15em] select-none">
          <span>scroll</span>
          <ArrowDown className="w-4 h-4 text-brand-primary/80 animate-bounce" />
        </div>
      </section>

      {/* ─── QUICK ACTIONS / LIVE CALCULATOR ─── */}
      <section className="relative z-20 py-24 px-6 md:px-12 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Action Card 1: Ship Now (Live Booking walkthrough) */}
          <div className="bg-bg-card border border-border-line/70 rounded-2xl p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-brand-primary/35 shadow-xl transition-all duration-300 relative group overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300" />
            <div>
              <div className="w-12 h-12 rounded-xl bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary mb-6">
                <Truck className="w-6 h-6 text-brand-primary" />
              </div>
              <h3 className="font-display font-[700] text-[22px] text-text-base mb-3 leading-tight">Ship Now</h3>
              <p className="text-text-muted text-sm leading-relaxed mb-6">
                Book a shipment in minutes. Express, Economy, Same-Day or Freight — choose what fits your deadline best. Secure cargo with ease.
              </p>
            </div>
            <button 
              onClick={() => {
                setBookingSuccessId(null)
                setBookingModalOpen(true)
              }}
              className="mt-4 px-5 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-bold rounded-lg border-none cursor-pointer text-left flex items-center justify-between group/btn transition-colors"
            >
              <span>Initialize instant booking</span>
              <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1.5 transition-transform" />
            </button>
          </div>

          {/* Action Card 2: Get a Quote (Interactive Freight Estimation Tool) */}
          <div className="bg-bg-card border border-border-line/70 rounded-2xl p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-brand-primary/35 shadow-xl transition-all duration-300 relative group overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300" />
            <div>
              <div className="w-12 h-12 rounded-xl bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary mb-6">
                <DollarSign className="w-6 h-6 text-brand-primary" />
              </div>
              <h3 className="font-display font-[700] text-[22px] text-text-base mb-3 leading-tight">Get a Quick Quote</h3>
              
              {/* Quick interactive parameters */}
              <div className="bg-bg-base/60 border border-border-line/60 rounded-xl p-4 my-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Origin</label>
                    <select 
                      value={quoteOrigin} 
                      onChange={(e) => setQuoteOrigin(e.target.value)}
                      className="w-full bg-bg-card border border-border-line text-xs font-medium rounded p-1.5 mt-1 focus:outline-none text-text-base"
                    >
                      <option value="Accra">Accra (ACC)</option>
                      <option value="London">London (LHR)</option>
                      <option value="New York">New York (JFK)</option>
                      <option value="Lagos">Lagos (LOS)</option>
                      <option value="Mumbai">Mumbai (BOM)</option>
                      <option value="Shanghai">Shanghai (PVG)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Destination</label>
                    <select 
                      value={quoteDestination} 
                      onChange={(e) => setQuoteDestination(e.target.value)}
                      className="w-full bg-bg-card border border-border-line text-xs font-medium rounded p-1.5 mt-1 focus:outline-none text-text-base"
                    >
                      <option value="Accra">Accra (ACC)</option>
                      <option value="London">London (LHR)</option>
                      <option value="New York">New York (JFK)</option>
                      <option value="Lagos">Lagos (LOS)</option>
                      <option value="Mumbai">Mumbai (BOM)</option>
                      <option value="Shanghai">Shanghai (PVG)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Weight</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="1000"
                      value={quoteWeight}
                      onChange={(e) => setQuoteWeight(e.target.value)}
                      className="w-full bg-bg-card border border-border-line text-xs font-semibold rounded p-1.5 mt-1 focus:outline-none text-text-base"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Service</label>
                    <select 
                      value={quoteService} 
                      onChange={(e) => setQuoteService(e.target.value)}
                      className="w-full bg-bg-card border border-border-line text-xs font-medium rounded p-1.5 mt-1 focus:outline-none text-text-base"
                    >
                      <option value="economy">Economy (3-5d)</option>
                      <option value="express">Express (1-2d)</option>
                      <option value="sameday">Same-Day (Hours)</option>
                    </select>
                  </div>
                </div>

                <div className="border-t border-border-line pt-2.5 mt-2 flex flex-col gap-1 text-xs">
                  {quoteBreakdown ? (
                    <>
                      <div className="flex justify-between items-center text-text-muted">
                        <span>Base:</span>
                        <span className="font-mono">${quoteBreakdown.basePrice.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-text-muted">
                        <span>Fuel surcharge (5%):</span>
                        <span className="font-mono">${quoteBreakdown.fuelSurcharge.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-text-muted">
                        <span>Tax (8.5%):</span>
                        <span className="font-mono">${quoteBreakdown.taxAmount.toFixed(2)}</span>
                      </div>
                      <div className="border-t border-border-line my-1"></div>
                      <div className="flex justify-between items-center font-bold">
                        <span className="text-text-base">Total:</span>
                        <span className="font-mono text-lg text-brand-primary">${quoteBreakdown.total.toFixed(2)}</span>
                      </div>
                      <div className="text-[10px] text-text-muted text-center pt-1 italic">
                        Est. delivery: {quoteBreakdown.estimatedDays} business days
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between items-center font-bold">
                      <span className="text-text-base">Total:</span>
                      <span className="font-mono text-lg text-brand-primary">$0.00</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Action Card 3: Business Solution (Highlight Perks) */}
          <div className="bg-bg-card border-t-4 border-t-brand-primary border border-border-line/70 rounded-2xl p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-brand-primary/35 shadow-xl transition-all duration-300 relative group overflow-hidden">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-950/20 dark:bg-emerald-900/40 border border-brand-primary/20 flex items-center justify-center text-brand-primary mb-6">
                <Building2 className="w-6 h-6 text-brand-primary" />
              </div>
              <h3 className="font-display font-[700] text-[22px] text-text-base mb-3 leading-tight">Shipwell for Business</h3>
              <p className="text-text-muted text-sm leading-relaxed mb-6">
                Shipping regularly? Bulk CSV uploading, monthly corporate invoicing, customized carrier integrations, and specialized discounts up to 30%.
              </p>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Check className="w-4 h-4 text-brand-primary shrink-0" />
                  <span>Dedicated corporate account manager</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Check className="w-4 h-4 text-brand-primary shrink-0" />
                  <span>Consolidated monthly invoicing</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Check className="w-4 h-4 text-brand-primary shrink-0" />
                  <span>Priority customs clearance brokerage</span>
                </div>
              </div>
            </div>
            <a href="#business" className="mt-8 text-sm font-bold text-brand-primary hover:text-brand-primary-hover flex items-center gap-1.5 transition-colors decoration-transparent group/link">
              <span>View business enterprise dashboard</span>
              <ArrowRight className="w-4 h-4 group-hover/link:translate-x-1.5 transition-transform" />
            </a>
          </div>

        </div>
      </section>

      {/* ─── SERVICES ─── */}
      <section id="services" className="py-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-t border-border-line/40">
        <div className="flex flex-col mb-16 text-left">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary mb-3">WHAT WE OFFER</span>
          <h2 className="font-display font-[800] text-3xl sm:text-5xl tracking-tight max-w-xl leading-none">
            Every Service.<br /><span className="text-brand-primary">One Unified Platform.</span>
          </h2>
          <p className="text-text-muted text-sm sm:text-base max-w-lg mt-4 leading-relaxed">
            From single envelopes to overseas cargo grids, we handle logistics securely with dedicated global lanes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card 1 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative overflow-hidden group hover:border-brand-primary/30 transition-all duration-300">
            <span className="absolute top-4 right-4 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded">FASTEST</span>
            <div className="w-10 h-10 rounded-lg bg-emerald-950/20 dark:bg-emerald-900/40 border border-brand-primary/20 flex items-center justify-center mb-6">
              <Zap className="w-5 h-5 text-brand-primary" />
            </div>
            <h4 className="font-display font-bold text-lg text-text-base mb-2">Express Delivery</h4>
            <p className="text-text-muted text-xs leading-relaxed mb-6">Next-day and 24-48hr door-to-door delivery. Ideal for high priority documents and urgent assets globally.</p>
            <div className="text-[48px] font-mono leading-none font-[800] text-border-line/10 absolute bottom-4 right-6 pointer-events-none group-hover:text-brand-primary/5 transition-colors">01</div>
          </div>

          {/* Card 2 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative overflow-hidden group hover:border-brand-primary/30 transition-all duration-300">
            <span className="absolute top-4 right-4 bg-emerald-950/30 border border-brand-primary/20 text-brand-primary text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded">POPULAR</span>
            <div className="w-10 h-10 rounded-lg bg-emerald-950/20 dark:bg-emerald-900/40 border border-brand-primary/20 flex items-center justify-center mb-6">
              <Clock className="w-5 h-5 text-brand-primary" />
            </div>
            <h4 className="font-display font-bold text-lg text-text-base mb-2">Economy Shipping</h4>
            <p className="text-text-muted text-xs leading-relaxed mb-6">High affordability shipping solution. Deliver reliably on an optimized 3-6 day timeline anywhere.</p>
            <div className="text-[48px] font-mono leading-none font-[800] text-border-line/10 absolute bottom-4 right-6 pointer-events-none group-hover:text-brand-primary/5 transition-colors">02</div>
          </div>

          {/* Card 3 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative overflow-hidden group hover:border-brand-primary/30 transition-all duration-300">
            <span className="absolute top-4 right-4 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded">CITY ONLY</span>
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center mb-6">
              <Activity className="w-5 h-5 text-brand-primary" />
            </div>
            <h4 className="font-display font-bold text-lg text-text-base mb-2">Same-Day Courier</h4>
            <p className="text-text-muted text-xs leading-relaxed mb-6">Immediate local courier dispatches. Simply book online before 10am to receive priority delivery by 6pm.</p>
            <div className="text-[48px] font-mono leading-none font-[800] text-border-line/10 absolute bottom-4 right-6 pointer-events-none group-hover:text-brand-primary/5 transition-colors">03</div>
          </div>

          {/* Card 4 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative overflow-hidden group hover:border-brand-primary/30 transition-all duration-300">
            <span className="absolute top-4 right-4 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded">HEAVY CARGO</span>
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center mb-6">
              <Truck className="w-5 h-5 text-brand-primary" />
            </div>
            <h4 className="font-display font-bold text-lg text-text-base mb-2">Freight & Large Goods</h4>
            <p className="text-text-muted text-xs leading-relaxed mb-6">Full Truckload (FTL), Sea Cargo, Container freight grids and specialized heavy transport handling.</p>
            <div className="text-[48px] font-mono leading-none font-[800] text-border-line/10 absolute bottom-4 right-6 pointer-events-none group-hover:text-brand-primary/5 transition-colors">04</div>
          </div>

          {/* Card 5 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative overflow-hidden group hover:border-brand-primary/30 transition-all duration-300">
            <span className="absolute top-4 right-4 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded">GLOBAL LTL</span>
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center mb-6">
              <Globe className="w-5 h-5 text-brand-primary" />
            </div>
            <h4 className="font-display font-bold text-lg text-text-base mb-2">Cross-Border lanes</h4>
            <p className="text-text-muted text-xs leading-relaxed mb-6">Comprehensive international shipping lanes. Includes full digital customs filings advice automatically.</p>
            <div className="text-[48px] font-mono leading-none font-[800] text-border-line/10 absolute bottom-4 right-6 pointer-events-none group-hover:text-brand-primary/5 transition-colors">05</div>
          </div>

          {/* Card 6 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative overflow-hidden group hover:border-brand-primary/30 transition-all duration-300">
            <span className="absolute top-4 right-4 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded">COMPLIANCE</span>
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center mb-6">
              <FileText className="w-5 h-5 text-brand-primary" />
            </div>
            <h4 className="font-display font-bold text-lg text-text-base mb-2">Customs Brokerage</h4>
            <p className="text-text-muted text-xs leading-relaxed mb-6">Automate tariff calculations, digital declarations, and HS coding with verified compliance brokers.</p>
            <div className="text-[48px] font-mono leading-none font-[800] text-border-line/10 absolute bottom-4 right-6 pointer-events-none group-hover:text-brand-primary/5 transition-colors">06</div>
          </div>

        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="process" className="py-24 bg-bg-card border-y border-border-line">
        <div className="max-w-7xl mx-auto px-6 md:px-12 w-full text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary mb-3 block">SIMPLE LOGISTICS END-TO-END</span>
          <h2 className="font-display font-[800] text-3xl sm:text-5xl tracking-tight max-w-xl mx-auto mb-16 leading-tight">
            Deliver in <span className="text-brand-primary">4 Easy Steps.</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative">
            
            {/* Steps separator visual line (desktop) */}
            <div className="hidden lg:block absolute top-[44px] left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-border-line via-brand-primary to-border-line pointer-events-none z-0" />

            {/* Step 1 */}
            <div className="flex flex-col items-center relative z-10">
              <div className="font-mono font-[800] text-lg text-brand-primary bg-bg-base border-2 border-brand-primary rounded-full w-[56px] h-[56px] flex items-center justify-center mb-6 shadow-md shadow-brand-primary/10">
                01
              </div>
              <h4 className="font-display font-bold text-base text-text-base mb-2">Book Online</h4>
              <p className="text-text-muted text-xs leading-relaxed max-w-[220px]">
                Enter source, destination, size parameters. Choose pricing tier, confirm.
              </p>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col items-center relative z-10">
              <div className="font-mono font-[800] text-lg text-brand-primary bg-bg-base border-2 border-brand-primary rounded-full w-[56px] h-[56px] flex items-center justify-center mb-6 shadow-md shadow-brand-primary/10">
                02
              </div>
              <h4 className="font-display font-bold text-base text-text-base mb-2">We Collect</h4>
              <p className="text-text-muted text-xs leading-relaxed max-w-[220px]">
                Schedule a premium courier pick up directly from your warehouse or doorstep.
              </p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center relative z-10">
              <div className="font-mono font-[800] text-lg text-brand-primary bg-bg-base border-2 border-brand-primary rounded-full w-[56px] h-[56px] flex items-center justify-center mb-6 shadow-md shadow-brand-primary/10">
                03
              </div>
              <h4 className="font-display font-bold text-base text-text-base mb-2">Dispatched</h4>
              <p className="text-text-muted text-xs leading-relaxed max-w-[220px]">
                Shipment sorted, routed, and fully tracked on your live personal dashboard.
              </p>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col items-center relative z-10">
              <div className="font-mono font-[800] text-lg text-brand-primary bg-bg-base border-2 border-brand-primary rounded-full w-[56px] h-[56px] flex items-center justify-center mb-6 shadow-md shadow-brand-primary/10">
                04
              </div>
              <h4 className="font-display font-bold text-base text-text-base mb-2">Delivered</h4>
              <p className="text-text-muted text-xs leading-relaxed max-w-[220px]">
                Client signs off, you receive confirmation and telemetry receipt instantly.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ─── COUNTERS STRIP ─── */}
      <section className="bg-emerald-950/20 dark:bg-emerald-950/10 border-b border-border-line/60 py-16 px-6 md:px-12 w-full">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center divide-y sm:divide-y-0 divide-border-line/20">
          <div className="py-4">
            <div className="font-display font-[800] text-4xl sm:text-5xl text-brand-primary tracking-tight leading-none">200M+</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mt-2">Packages Tracked</div>
          </div>
          <div className="py-4">
            <div className="font-display font-[800] text-4xl sm:text-5xl text-brand-primary tracking-tight leading-none">180+</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mt-2">Countries Covered</div>
          </div>
          <div className="py-4">
            <div className="font-display font-[800] text-4xl sm:text-5xl text-brand-primary tracking-tight leading-none">99.98%</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mt-2">On-Time Delivery</div>
          </div>
          <div className="py-4">
            <div className="font-display font-[800] text-4xl sm:text-5xl text-brand-primary tracking-tight leading-none">24/7</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mt-2">Live Support Line</div>
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto w-full">
        <div className="text-center mb-16">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary mb-3 block">TESTIMONIALS</span>
          <h2 className="font-display font-[800] text-3.5xl sm:text-5xl tracking-tight max-w-xl mx-auto leading-none">
            Trusted by Thousands.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Testimonial 1 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative flex flex-col justify-between">
            <span className="absolute top-6 right-6 font-serif text-6xl text-border-line/20 select-none pointer-events-none">&ldquo;</span>
            <div>
              <div className="text-emerald-500 text-sm tracking-wider mb-4">★★★★★</div>
              <p className="text-text-muted text-sm italic leading-relaxed mb-6">
                Switched from DHL six months ago. The tracking timeline detail is night and day — I can actually observe exact package coordinates in real-time, removing raw guesswork.
              </p>
            </div>
            <div className="flex items-center gap-3 border-t border-border-line/40 pt-4 mt-2">
              <div className="w-[38px] h-[38px] rounded-full bg-brand-primary/10 border border-brand-primary/30 flex items-center justify-center font-display font-extrabold text-sm text-brand-primary">
                JM
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold text-text-base leading-tight">James Mensah</span>
                <span className="text-[11px] text-text-muted">Import/Export · Accra</span>
              </div>
            </div>
          </div>

          {/* Testimonial 2 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative flex flex-col justify-between">
            <span className="absolute top-6 right-6 font-serif text-6xl text-border-line/20 select-none pointer-events-none">&ldquo;</span>
            <div>
              <div className="text-emerald-500 text-sm tracking-wider mb-4">★★★★★</div>
              <p className="text-text-muted text-sm italic leading-relaxed mb-6">
                The business portal setup is incredibly designed. I operate 200+ shipments monthly from one bento grid. The bulk shipment generator alone saves me hours weekly.
              </p>
            </div>
            <div className="flex items-center gap-3 border-t border-border-line/40 pt-4 mt-2">
              <div className="w-[38px] h-[38px] rounded-full bg-brand-primary/10 border border-brand-primary/30 flex items-center justify-center font-display font-extrabold text-sm text-brand-primary">
                SO
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold text-text-base leading-tight">Sarah Okonkwo</span>
                <span className="text-[11px] text-text-muted">E-commerce Founder · Lagos</span>
              </div>
            </div>
          </div>

          {/* Testimonial 3 */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-8 relative flex flex-col justify-between">
            <span className="absolute top-6 right-6 font-serif text-6xl text-border-line/20 select-none pointer-events-none">&ldquo;</span>
            <div>
              <div className="text-emerald-500 text-sm tracking-wider mb-4">★★★★★</div>
              <p className="text-text-muted text-sm italic leading-relaxed mb-6">
                Customs clearance was completed in under 24 hours. Their brokerage department handles duties, paperwork, compliance and filings with zero friction. Highly recommend.
              </p>
            </div>
            <div className="flex items-center gap-3 border-t border-border-line/40 pt-4 mt-2">
              <div className="w-[38px] h-[38px] rounded-full bg-brand-primary/10 border border-brand-primary/30 flex items-center justify-center font-display font-extrabold text-sm text-brand-primary">
                RK
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold text-text-base leading-tight">Ravi Kumar</span>
                <span className="text-[11px] text-text-muted">Lanes Logistics manager · Mumbai</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ─── BUSINESS CTA & ENTERPRISE PREVIEW ─── */}
      <section id="business" className="py-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-t border-border-line/40">
        <div className="bg-bg-card border border-border-line rounded-[24px] p-8 md:p-14 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative overflow-hidden">
          
          <div className="lg:col-span-7 flex flex-col items-start">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary mb-3">FOR LARGER SCALE</span>
            <h2 className="font-display font-[800] text-3xl sm:text-[44px] tracking-tight leading-[1.1] mb-6">
              Shipping more than <br />
              <span className="text-brand-primary">50 packages a month?</span>
            </h2>
            <p className="text-text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-lg">
              Unlock volume tier discounts, get connected with a personal account manager, invite team seats with customized scoping rules, and pay via consolidated monthly invoices.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 mb-10 w-full max-w-xl">
              <div className="flex items-center gap-2.5 text-xs text-text-muted font-medium">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><Check className="w-3.5 h-3.5" /></div>
                <span>Up to 30% off standard billing rates</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-text-muted font-medium">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><Check className="w-3.5 h-3.5" /></div>
                <span>Consolidated monthly invoicing</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-text-muted font-medium">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><Check className="w-3.5 h-3.5" /></div>
                <span>Dedicated account supervisor</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-text-muted font-medium">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><Check className="w-3.5 h-3.5" /></div>
                <span>Priority customs brokerage routing</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-text-muted font-medium">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><Check className="w-3.5 h-3.5" /></div>
                <span>Bulk CSV bulk shipment generator</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-text-muted font-medium">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><Check className="w-3.5 h-3.5" /></div>
                <span>Multiple accounts team management seatings</span>
              </div>
            </div>

            <Link href="/admin" className="px-8 py-3.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-bold tracking-wide uppercase rounded-xl border-none cursor-pointer transition-colors leading-none decoration-transparent shadow shadow-brand-primary/20">
              Create a Corporate Account
            </Link>
          </div>

          {/* Interactive Live Dashboard KPI Simulator */}
          <div className="lg:col-span-5 w-full">
            <div className="bg-bg-base border border-border-line rounded-2xl p-6 md:p-8 flex flex-col gap-6 relative shadow-lg">
              <div className="flex justify-between items-center pb-2 border-b border-border-line/45">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Business Dashboard · Live</span>
                </div>
                <span className="text-[9px] font-mono bg-brand-primary/15 text-brand-primary px-2 py-0.5 rounded uppercase font-bold">Lanes API Connected</span>
              </div>

              <div className="flex justify-between items-end">
                <div className="flex flex-col gap-0.5">
                  <span className="text-3xl md:text-4xl font-mono font-bold text-brand-primary tracking-tight">
                    {shipmentCount}
                  </span>
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active bookings this period</span>
                </div>
                <div className="text-xs text-emerald-500 font-bold bg-emerald-950/20 px-2 py-1 rounded">
                  &uarr; 14.8% vs last month
                </div>
              </div>

              <div className="h-px bg-border-line/45" />

              <div className="flex justify-between items-end">
                <div className="flex flex-col gap-0.5">
                  <span className="text-2xl md:text-3xl font-mono font-bold text-text-base">
                    ${savedAmount.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Calculated Volume Savings</span>
                </div>
                <div className="text-[11px] font-mono text-brand-primary font-bold">
                  22% global tier rate
                </div>
              </div>

              <div className="h-px bg-border-line/45" />

              <div className="flex justify-between items-center">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-mono font-bold text-text-base">99.2%</span>
                  <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Lanes On-Time Guarantee</span>
                </div>
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest bg-emerald-900/20 px-2.5 py-0.5 rounded-full">
                  Excellent status
                </span>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* ─── CONTINUOUS PARTNERS ROBO LOOP ─── */}
      <section className="py-16 border-y border-border-line overflow-hidden w-full bg-bg-surface/20 relative">
        <div className="text-center mb-8">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-text-muted/60 select-none">Trusted by Global Enterprises and Manufacturers</span>
        </div>
        
        {/* Continuous looping strip using CSS animation class */}
        <div className="relative w-full overflow-hidden select-none">
          {/* subtle fading masks */}
          <div className="absolute top-0 bottom-0 left-0 w-32 bg-gradient-to-r from-bg-base to-transparent z-10 pointer-events-none" />
          <div className="absolute top-0 bottom-0 right-0 w-32 bg-gradient-to-l from-bg-base to-transparent z-10 pointer-events-none" />

          <div className="flex gap-[68px] w-max animate-scroll-x select-none">
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">GLOBALTECH INC.</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">NOVA MANUFACTURING</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">PANAFRICAN COMMERCIAL</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">MERIDIAN SHIPPING GROUP</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">AXIOM FREIGHT CARRIERS</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">CRESTLINE LOGISTICS</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">UNITY GLOBAL PORTS</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">DELTA SHIPPING LANES</span>

            {/* Duplicates for seamless looping */}
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">GLOBALTECH INC.</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">NOVA MANUFACTURING</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">PANAFRICAN COMMERCIAL</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">MERIDIAN SHIPPING GROUP</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">AXIOM FREIGHT CARRIERS</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">CRESTLINE LOGISTICS</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">UNITY GLOBAL PORTS</span>
            <span className="text-lg font-display font-extrabold text-border-line/40 hover:text-brand-primary transition-colors cursor-default">DELTA SHIPPING LANES</span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-bg-card border-t border-border-line/80 px-6 md:px-12 py-20 w-full relative z-20">
        <div className="max-w-7xl mx-auto flex flex-col gap-12">
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
            
            {/* Branding Column */}
            <div className="lg:col-span-2 flex flex-col items-start gap-4">
              <Link href="/" className="flex items-center gap-2 decoration-transparent">
                <div className="w-[34px] h-[34px] rounded-lg bg-emerald-950/20 dark:bg-emerald-900/40 border border-brand-primary/30 flex items-center justify-center">
                  <Truck className="w-4 h-4 text-brand-primary" />
                </div>
                <div className="flex flex-col">
                  <span className="font-display font-extrabold text-[18px] text-text-base tracking-tight leading-none">Shipwell</span>
                  <span className="text-[8px] font-semibold tracking-widest uppercase text-brand-primary mt-1 leading-none">
                    Track · Deliver · Repeat
                  </span>
                </div>
              </Link>
              <p className="text-text-muted text-xs leading-relaxed max-w-sm mt-1">
                The world&apos;s leading high-precision logistics platform. Connecting destinations, optimizing supply routes and routing materials with absolute safety.
              </p>
            </div>

            {/* Column 1 */}
            <div className="flex flex-col items-start gap-3.5">
              <span className="text-[11px] font-[800] uppercase tracking-wider text-text-base">Logistics Services</span>
              <ul className="flex flex-col items-start gap-2.5 list-none m-0 p-0 text-text-muted text-xs font-medium">
                <li><a href="#services" className="hover:text-brand-primary transition-colors">Express Lanes Shipping</a></li>
                <li><a href="#services" className="hover:text-brand-primary transition-colors">Economy Standard lanes</a></li>
                <li><a href="#services" className="hover:text-brand-primary transition-colors">Same-day Couriers</a></li>
                <li><a href="#services" className="hover:text-brand-primary transition-colors">Heavy Freight & LTL Cargo</a></li>
                <li><a href="#services" className="hover:text-brand-primary transition-colors">Brokerage filings help</a></li>
              </ul>
            </div>

            {/* Column 2 */}
            <div className="flex flex-col items-start gap-3.5">
              <span className="text-[11px] font-[800] uppercase tracking-wider text-text-base">Support & Help</span>
              <ul className="flex flex-col items-start gap-2.5 list-none m-0 p-0 text-text-muted text-xs font-medium">
                <li><a href="#track" className="hover:text-brand-primary transition-colors">Find shipment</a></li>
                <li><Link href="/admin" className="hover:text-brand-primary transition-colors">Admin controls</Link></li>
                <li><Link href="/admin" className="hover:text-brand-primary transition-colors">Register as client</Link></li>
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Office local nodes</a></li>
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Lanes status hub</a></li>
              </ul>
            </div>

            {/* Column 3 */}
            <div className="flex flex-col items-start gap-3.5">
              <span className="text-[11px] font-[800] uppercase tracking-wider text-text-base">Information</span>
              <ul className="flex flex-col items-start gap-2.5 list-none m-0 p-0 text-text-muted text-xs font-medium">
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Security Rules</a></li>
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Compliance terms</a></li>
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Cookie settings</a></li>
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Fraud awareness alert</a></li>
                <li><a href="#navbar" className="hover:text-brand-primary transition-colors">Privacy policy guidelines</a></li>
              </ul>
            </div>

          </div>

          <div className="pt-8 border-t border-border-line/45 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-text-muted font-medium">
            <span>&copy; 2026 ShipWell Logistics Inc. All rights reserved.</span>
            <div className="flex items-center gap-6">
              <a href="#" className="hover:text-brand-primary transition-colors">Privacy</a>
              <a href="#" className="hover:text-brand-primary transition-colors">Licensing terms</a>
              <a href="#" className="hover:text-brand-primary transition-colors">API access tokens</a>
              <Link href="/admin" className="text-brand-primary font-bold hover:underline">Admin Panel</Link>
            </div>
          </div>

        </div>
      </footer>

      {/* ─── BOOKING WALKTHROUGH MODAL ─── */}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-lg p-6 md:p-8 relative shadow-2xl animate-scale-up">
            
            <button 
              onClick={() => setBookingModalOpen(false)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {!bookingSuccessId ? (
              <form onSubmit={handleInitiateBooking} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <h3 className="font-display font-extrabold text-[22px] leading-tight">Instant Shipment Booking</h3>
                  <span className="text-xs text-text-muted">Simulate a real cargo assignment to generate tracking keys.</span>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Sender Identification (Full name)</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Acme Corporation" 
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Recipient Identification (Full name)</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. John Doe logistics hub" 
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Origin City</label>
                      <input 
                        type="text" 
                        required
                        placeholder="Accra" 
                        className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Destination City</label>
                      <input 
                        type="text" 
                        required
                        placeholder="London" 
                        className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Item Description</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Electronic spare components" 
                      value={pkgDesc}
                      onChange={(e) => setPkgDesc(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div className="bg-bg-base p-4 rounded-xl flex items-center justify-between border border-border-line/80 mt-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Booking Fee estimate</span>
                    <span className="text-xs text-text-muted/80">Includes lanes insurance</span>
                  </div>
                  <span className="font-mono text-xl font-[800] text-brand-primary">$64.00</span>
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  <button 
                    type="submit"
                    className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold tracking-wider uppercase py-4 rounded-xl border-none cursor-pointer transition-colors"
                  >
                    Confirm Booking Assignment
                  </button>
                  <p className="text-[10px] text-text-muted/80 text-center leading-normal">
                    Note: To permanently commit and update this shipment in the live database, login to the Admin Portal with verified credentials.
                  </p>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center text-center py-6 gap-6">
                <div className="w-14 h-14 rounded-full bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary animate-scale-up">
                  <Check className="w-8 h-8" />
                </div>
                
                <div className="flex flex-col gap-2">
                  <h3 className="font-display font-extrabold text-2xl text-text-base">Shipment Scheduled</h3>
                  <p className="text-xs text-text-muted max-w-sm leading-relaxed">
                    The assignment has been successfully created. We have simulated your tracking identification code:
                  </p>
                </div>

                <div className="bg-bg-base select-all font-mono font-bold text-center border-2 border-dashed border-brand-primary/40 px-6 py-4 rounded-xl text-brand-primary text-lg tracking-wider relative group">
                  {bookingSuccessId}
                </div>

                <p className="text-[11px] text-text-muted font-medium bg-brand-primary/5 px-3 py-1.5 rounded-full flex items-center gap-1.5 border border-brand-primary/10">
                  <Info className="w-3.5 h-3.5 text-brand-primary shrink-0" /> Note the tracking ID above to test search flows on the tracker!
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full mt-4">
                  <button 
                    onClick={() => {
                      setTrackingId(bookingSuccessId)
                      setBookingModalOpen(false)
                      router.push(`/track/${bookingSuccessId}`)
                    }}
                    className="flex-1 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl border-none cursor-pointer"
                  >
                    Track in Real-Time
                  </button>
                  <button 
                    onClick={() => setBookingModalOpen(false)}
                    className="flex-1 bg-bg-base border border-border-line text-text-base hover:bg-bg-card text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl cursor-pointer"
                  >
                    Close Walkthrough
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ─── MULTI-PACKAGE TRACKER MODAL ─── */}
      {multiTrackerOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl animate-scale-up">
            <button 
              onClick={() => setMultiTrackerOpen(false)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-col gap-4 text-left">
              <div className="flex flex-col gap-1">
                <h3 className="font-display font-extrabold text-[22px] leading-tight">Multi-Package Core Tracker</h3>
                <span className="text-xs text-text-muted">Trace multiple Shipwell tracking hashes concurrently (comma or space separated).</span>
              </div>

              <div className="flex flex-col gap-3">
                <textarea
                  rows={3}
                  value={multiTrackingInput}
                  onChange={(e) => setMultiTrackingInput(e.target.value)}
                  placeholder="e.g. SW-2026-X4A92, SW-2026-Y892A, SW-2026-90B12"
                  className="bg-bg-base border border-border-line p-3.5 rounded-xl font-mono text-xs text-text-base focus:outline-none focus:border-brand-primary w-full resize-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setMultiTrackingLoading(true);
                    setMultiTrackingResults([]);
                    const keys = multiTrackingInput.split(/[\s,]+/).map(k => k.trim().toUpperCase()).filter(Boolean);
                    if (keys.length === 0) {
                      setMultiTrackingLoading(false);
                      return;
                    }
                    const list: any[] = [];
                    for (const key of keys) {
                      try {
                        const docRef = doc(db, 'shipments', key);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                          const data = docSnap.data();
                          list.push({ id: key, found: true, status: data.status, origin: data.originCity, destination: data.destinationCity });
                        } else {
                          const localRaw = localStorage.getItem(`shipwell_guest_tracking_${key}`);
                          if (localRaw) {
                            const parsed = JSON.parse(localRaw);
                            list.push({ id: key, found: true, status: parsed.status, origin: parsed.origin?.city, destination: parsed.destination?.city });
                          } else {
                            list.push({ id: key, found: false });
                          }
                        }
                      } catch (e) {
                        list.push({ id: key, found: false });
                      }
                    }
                    setMultiTrackingResults(list);
                    setMultiTrackingLoading(false);
                  }}
                  disabled={multiTrackingLoading}
                  className="bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl border-none cursor-pointer flex items-center justify-center gap-2"
                >
                  {multiTrackingLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Trace Package Nodes
                </button>
              </div>

              {multiTrackingResults.length > 0 && (
                <div className="flex flex-col gap-2.5 max-h-56 overflow-y-auto mt-2 border-t border-border-line/45 pt-4">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Consolidated Tracking State</span>
                  <div className="flex flex-col gap-1.5">
                    {multiTrackingResults.map((res, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-bg-base border border-border-line/60 rounded-xl">
                        <div className="flex flex-col gap-0.5 text-left">
                          <span className="text-xs font-mono font-bold text-brand-primary">{res.id}</span>
                          <span className="text-[10px] text-text-muted">
                            {res.found ? `${res.origin} → ${res.destination}` : 'Unrecognized Shipwell tag ID'}
                          </span>
                        </div>
                        <div>
                          {res.found ? (
                            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-brand-primary/10 text-brand-primary font-mono uppercase">
                              {res.status}
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-red-500/10 text-red-500 font-mono">
                              NOT FOUND
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── COURIER DOOR PICKUP MODAL ─── */}
      {pickupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-lg p-6 md:p-8 relative shadow-2xl animate-scale-up">
            <button 
              onClick={() => setPickupModalOpen(false)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {!pickupSuccess ? (
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  setPickupSubmitting(true);
                  const pickupId = `SW-PCK-${Math.floor(Math.random() * 90000 + 10000)}`;
                  try {
                    if (user) {
                      // Save pickup as a Support Ticket of category 'pickup'
                      const ticketRef = doc(collection(db, "tickets"));
                      await setDoc(ticketRef, {
                        userId: user.uid,
                        subject: `Door Pickup Booking: [${pickupId}]`,
                        message: `Courier pick up requested at Address: ${pickupAddress}. Scheduled Date: ${pickupDate}, Time Window: ${pickupTime}. Speed: ${pickupSpeed}. Contact Phone: ${pickupPhone}`,
                        category: "PICKUP",
                        status: "OPEN",
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                      });
                    }
                    setPickupSuccess(pickupId);
                  } catch (err) {
                    console.error("Pickup scheduling failed:", err);
                    alert("Error registering door pickup. Please ensure you have configured database access.");
                  } finally {
                    setPickupSubmitting(false);
                  }
                }} 
                className="flex flex-col gap-5 text-left"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="font-display font-extrabold text-[22px] leading-tight">Doorstep Courier Pickup</h3>
                  <span className="text-xs text-text-muted">A dispatch rider is directly assigned to harvest your package.</span>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Pickup Street Address</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Plot 42 Ring Road East, Accra" 
                      value={pickupAddress}
                      onChange={(e) => setPickupAddress(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Contact Phone number</label>
                      <input 
                        type="tel" 
                        required
                        placeholder="+233 24 000 0000" 
                        value={pickupPhone}
                        onChange={(e) => setPickupPhone(e.target.value)}
                        className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Cargo Harvest Date</label>
                      <input 
                        type="date" 
                        required
                        value={pickupDate}
                        onChange={(e) => setPickupDate(e.target.value)}
                        className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Time Frame Window</label>
                      <select 
                        value={pickupTime}
                        onChange={(e) => setPickupTime(e.target.value)}
                        className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                      >
                        <option value="morning">Morning (08:00 - 12:00)</option>
                        <option value="afternoon">Afternoon (12:00 - 16:00)</option>
                        <option value="evening">Evening (16:00 - 19:00)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Dispatch Lane Tier</label>
                      <select 
                        value={pickupSpeed}
                        onChange={(e) => setPickupSpeed(e.target.value)}
                        className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                      >
                        <option value="express">Express Overnight (Air)</option>
                        <option value="economy">Economy Standard (Ground)</option>
                        <option value="same-day">Instant Courier Lane</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  <button 
                    type="submit"
                    disabled={pickupSubmitting}
                    className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold tracking-wider uppercase py-4 rounded-xl border-none cursor-pointer transition-colors flex items-center justify-center gap-2"
                  >
                    {pickupSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Schedule Door Collection
                  </button>
                  <p className="text-[10px] text-text-muted/80 text-center leading-normal">
                    Assigned courier riders are fully GPS-tracked. Live coordinate mapping updates on your Dashboard immediately upon collection.
                  </p>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center text-center py-6 gap-6">
                <div className="w-14 h-14 rounded-full bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
                  <Check className="w-8 h-8" />
                </div>
                
                <div className="flex flex-col gap-2">
                  <h3 className="font-display font-extrabold text-2xl text-text-base">Door Pickup Booked!</h3>
                  <p className="text-xs text-text-muted max-w-sm leading-relaxed">
                    A dispatch courier has been allocated to address <span className="font-bold text-text-base">{pickupAddress}</span>. Reference code identifier:
                  </p>
                </div>

                <div className="bg-bg-base font-mono font-bold text-center border px-6 py-4 rounded-xl text-brand-primary text-base">
                  {pickupSuccess}
                </div>

                <p className="text-[11px] text-text-muted font-medium bg-brand-primary/5 px-4 py-2 border border-brand-primary/10 rounded-xl leading-normal text-center">
                  {user ? "Your booking has been written to Firestore support tickets! Access your dashboard to communicate with courier supervisors." : "Doorstep courier booked. Register an account to review pickup records permanently."}
                </p>

                <button 
                  onClick={() => setPickupModalOpen(false)}
                  className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl border-none cursor-pointer mt-2"
                >
                  Return to Workspace
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── VOLUMETRIC WEIGHT ANALYZER MODAL ─── */}
      {volumetricModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-md p-6 md:p-8 relative shadow-2xl animate-scale-up">
            <button 
              onClick={() => setVolumetricModalOpen(false)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex flex-col gap-5 text-left">
              <div className="flex flex-col gap-1">
                <h3 className="font-display font-extrabold text-xl leading-tight">Volumetric Weight Analyzer</h3>
                <span className="text-xs text-text-muted">Air courier lines bill by whichever scale is higher (Actual vs. Dimensional Weight).</span>
              </div>

              <div className="flex flex-col gap-3.5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] uppercase font-bold tracking-wider text-text-muted font-mono">Length (cm)</label>
                    <input 
                      type="number" 
                      value={volumeLength}
                      onChange={(e) => setVolumeLength(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-center text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] uppercase font-bold tracking-wider text-text-muted font-mono">Width (cm)</label>
                    <input 
                      type="number" 
                      value={volumeWidth}
                      onChange={(e) => setVolumeWidth(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-center text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] uppercase font-bold tracking-wider text-text-muted font-mono">Height (cm)</label>
                    <input 
                      type="number" 
                      value={volumeHeight}
                      onChange={(e) => setVolumeHeight(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-center text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono font-bold">Actual Scale Weight (kg)</label>
                  <input 
                    type="number" 
                    value={volumeWeight}
                    onChange={(e) => setVolumeWeight(e.target.value)}
                    className="bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const l = parseFloat(volumeLength) || 0;
                    const w = parseFloat(volumeWidth) || 0;
                    const h = parseFloat(volumeHeight) || 0;
                    const actual = parseFloat(volumeWeight) || 0;
                    const vol = Math.round((l * w * h) / 5000 * 10) / 10;
                    const billable = Math.max(actual, vol);
                    setVolumeResult({
                      volumetricWeight: vol,
                      billableWeight: billable,
                      isVolumetric: vol > actual
                    });
                  }}
                  className="bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl border-none cursor-pointer mt-2"
                >
                  Analyze Dimensional Weights
                </button>
              </div>

              {volumeResult && (
                <div className="p-4 rounded-xl border bg-bg-base border-border-line flex flex-col gap-3 mt-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-text-muted">Calculated Volumetric Weight:</span>
                    <span className="font-mono font-bold text-text-base">{volumeResult.volumetricWeight} kg</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-border-line/45 pt-2.5">
                    <span className="text-text-muted">Actual Measured Weight:</span>
                    <span className="font-mono font-bold text-text-base">{volumeWeight} kg</span>
                  </div>
                  <div className="flex justify-between items-center px-3 py-2.5 rounded-lg bg-brand-primary/10 border border-brand-primary/20 mt-1">
                    <span className="text-xs font-bold text-brand-primary">Billable Scale Weight:</span>
                    <span className="font-mono font-extrabold text-brand-primary text-sm">{volumeResult.billableWeight} kg</span>
                  </div>
                  <p className="text-[10px] text-text-muted leading-tight">
                    {volumeResult.isVolumetric ? "⚠️ Charge billed by Volumetric Size because spatial bulk exceeds packaging scale weight." : "✓ Billed by Actual Weight. Package spatial bulk complies with standard aviation dimensional limits."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── BULK CSV SHIPMENT GENERATOR MODAL ─── */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl animate-scale-up">
            <button 
              onClick={() => setBulkModalOpen(false)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex flex-col gap-4 text-left">
              <div className="flex flex-col gap-1">
                <h3 className="font-display font-extrabold text-[22px] leading-tight">Bulk CSV Shipment Parser</h3>
                <span className="text-xs text-text-muted">Directly create dozens of Shipwell cargo labels and trace keys simultaneously.</span>
              </div>

              {bulkResults.length === 0 ? (
                <div className="flex flex-col gap-4 text-left">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted font-mono">Input Shipment Rows (CSV layout)</span>
                    <span className="text-[10px] text-text-muted">Columns: Sender, Recipient, Destination City, Weight (kg), Description</span>
                    <textarea
                      rows={5}
                      value={bulkCsvInput}
                      onChange={(e) => setBulkCsvInput(e.target.value)}
                      placeholder="e.g.&#10;Acme Freight, Bob Cargo, London, 15, Industrial Pipes&#10;Global Traders, Sarah Hub, Tokyo, 4, Accessories Label"
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-primary resize-none w-full"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setBulkSubmitting(true);
                      const lines = bulkCsvInput.split("\n").map(l => l.trim()).filter(Boolean);
                      const processed: any[] = [];
                      for (const line of lines) {
                        const cols = line.split(",").map(c => c.trim());
                        if (cols.length < 3) continue;
                        const sender = cols[0];
                        const recipient = cols[1];
                        const city = cols[2];
                        const weight = cols[3] || "5";
                        const desc = cols[4] || "General Freight Cargo";
                        
                        const rid = `SW-${Math.floor(Math.random() * 900000 + 100000)}`;
                        try {
                          if (user) {
                            // Register in Firestore securely
                            const shipmentRef = doc(db, "shipments", rid);
                            await setDoc(shipmentRef, {
                              userId: user.uid,
                              status: "PENDING",
                              carrier: "Shipwell Bulk Express",
                              trackingNumber: rid,
                              originCity: "Accra",
                              originState: "GH",
                              originZip: "00233",
                              destinationCity: city,
                              destinationState: "INTL",
                              destinationZip: "00000",
                              createdAt: serverTimestamp(),
                              updatedAt: serverTimestamp()
                            });

                            const timelineRef = doc(collection(db, `shipments/${rid}/events`));
                            await setDoc(timelineRef, {
                              isLogical: false,
                              isLatest: true,
                              statusColor: "bg-emerald-500",
                              eventCode: "PENDING",
                              label: "Bulk shipment compiled",
                              description: `Processed from corporate bulk CSV upload. Weight: ${weight}kg, Content: ${desc}. Scheduled for transit to ${city}.`,
                              facility: "Shipwell Corporate Terminal",
                              location: "Customs Node",
                              formattedDate: "Today",
                              formattedTime: "Just Now",
                              createdAt: serverTimestamp()
                            });
                          } else {
                            // Local browser simulation saving
                            const guestBooking = {
                              status: "PENDING",
                              carrier: "Shipwell Bulk Guest",
                              trackingNumber: rid,
                              origin: { city: "Accra", state: "GH", zip: "00233" },
                              destination: { city: city, state: "INTL", zip: "00000" },
                              events: [
                                {
                                  id: "evt-init",
                                  isLogical: false,
                                  isLatest: true,
                                  statusColor: "bg-amber-500",
                                  eventCode: "PENDING",
                                  label: "Bulk simulation printed",
                                  description: `Pending collection. Weight Detail: ${weight} kg, Packaging: ${desc}.`,
                                  location: "Corporate Local Node",
                                  formattedDate: "Today",
                                  formattedTime: "Just Now"
                                }
                              ]
                            };
                            localStorage.setItem(`shipwell_guest_tracking_${rid}`, JSON.stringify(guestBooking));
                          }
                          processed.push({ id: rid, sender, recipient, city, status: "SUCCESS" });
                          addToSearchHistory(rid);
                        } catch (e) {
                          processed.push({ id: rid, sender, recipient, city, status: "FAILED" });
                        }
                      }
                      setBulkResults(processed);
                      setBulkSubmitting(false);
                    }}
                    disabled={bulkSubmitting}
                    className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold uppercase tracking-wider py-4 rounded-xl border-none cursor-pointer flex items-center justify-center gap-2"
                  >
                    {bulkSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Compile & Register Bulk Rows
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4 text-left">
                  <div className="flex justify-between items-center border-b border-border-line/45 pb-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-brand-primary font-mono">Parsed Records</span>
                    <span className="text-[10px] text-text-muted">{bulkResults.length} shipments logged</span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                    {bulkResults.map((itm, index) => (
                      <div key={index} className="flex justify-between items-center p-3 bg-bg-base border border-border-line rounded-xl">
                        <div className="flex flex-col text-left">
                          <span className="text-xs font-mono font-bold text-brand-primary">{itm.id}</span>
                          <span className="text-[10px] text-text-muted">To: {itm.recipient} ({itm.city})</span>
                        </div>
                        <span className="text-[9px] font-bold bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded">
                          {itm.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  <p className="text-[11px] text-text-muted font-medium bg-brand-primary/5 px-4 py-2 border border-brand-primary/10 rounded-xl leading-relaxed text-center">
                    {user ? "These parsed rows have been securely written to your live database shipments! View customer dashboard to monitor progress." : "Your Simulated labels are saved to your local session workspace. Use tracking panel to look them up."}
                  </p>

                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => setBulkResults([])}
                      className="flex-1 bg-bg-base border border-border-line text-text-base hover:bg-bg-card font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl cursor-pointer"
                    >
                      Process More
                    </button>
                    <button
                      onClick={() => setBulkModalOpen(false)}
                      className="flex-1 bg-brand-primary hover:bg-brand-primary-hover text-white font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl border-none cursor-pointer"
                    >
                      Complete Session
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── DEVELOPER API TERMINAL MODAL ─── */}
      {devApiOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-2xl p-6 md:p-8 relative shadow-2xl animate-scale-up">
            <button 
              onClick={() => setDevApiOpen(false)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex flex-col gap-4 text-left">
              <div className="flex flex-col gap-1 pb-2 border-b border-border-line/45">
                <span className="text-xs font-bold text-brand-primary uppercase tracking-widest font-mono">Developer API Terminal</span>
                <span className="text-xs text-text-muted font-sans">Accelerate your e-commerce platform with high-speed automated logistics webhooks.</span>
              </div>

              {/* Lang Tabs */}
              <div className="flex gap-2">
                {[
                  { id: 'curl', label: 'cURL' },
                  { id: 'js', label: 'Node.js' },
                  { id: 'python', label: 'Python' }
                ].map((tb) => (
                  <button
                    key={tb.id}
                    onClick={() => setDevApiLang(tb.id as any)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition-colors cursor-pointer ${devApiLang === tb.id ? 'bg-brand-primary text-white border-brand-primary' : 'bg-transparent text-text-muted border-border-line hover:text-text-base'}`}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>

              {/* Code Panel */}
              <div className="relative">
                <pre className="p-4 bg-bg-base border border-border-line rounded-xl text-[11px] font-mono text-text-muted overflow-x-auto leading-relaxed text-left select-all">
                  {devApiLang === 'curl' && `curl -X POST https://api.shipwell.com/v1/shipments \\
  -H "Authorization: Bearer sw_live_8291a82b9e" \\
  -H "Content-Type: application/json" \\
  -d '{
    "origin": {"city": "Accra", "country": "GH"},
    "destination": {"city": "London", "country": "UK"},
    "carrier": "Shipwell Air Express",
    "description": "High value microchips"
  }'`}
                  {devApiLang === 'js' && `const axios = require('axios');

axios.post('https://api.shipwell.com/v1/shipments', {
  origin: { city: 'Accra', country: 'GH' },
  destination: { city: 'London', country: 'UK' },
  carrier: 'Shipwell Air Express',
  description: 'High value microchips'
}, {
  headers: { 'Authorization': 'Bearer sw_live_8291a82b9e' }
})
.then(res => console.log(\`Tracking ID: \${res.data.trackingId}\`))
.catch(err => console.error(err));`}
                  {devApiLang === 'python' && `import requests

url = "https://api.shipwell.com/v1/shipments"
headers = {
    "Authorization": "Bearer sw_live_8291a82b9e",
    "Content-Type": "application/json"
}
payload = {
    "origin": {"city": "Accra", "country": "GH"},
    "destination": {"city": "London", "country": "UK"},
    "carrier": "Shipwell Air Express",
    "description": "High value microchips"
}

response = requests.post(url, json=payload, headers=headers)
print(f"Node Track Registered: {response.json().get('trackingId')}")`}
                </pre>

                <button
                  type="button"
                  onClick={() => {
                    let codeText = "";
                    if (devApiLang === 'curl') {
                      codeText = `curl -X POST https://api.shipwell.com/v1/shipments \\\n  -H "Authorization: Bearer sw_live_8291a82b9e" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "origin": {"city": "Accra", "country": "GH"},\n    "destination": {"city": "London", "country": "UK"},\n    "carrier": "Shipwell Air Express",\n    "description": "High value microchips"\n  }'`;
                    } else if (devApiLang === 'js') {
                      codeText = `const axios = require('axios');\n\naxios.post('https://api.shipwell.com/v1/shipments', {\n  origin: { city: 'Accra', country: 'GH' },\n  destination: { city: 'London', country: 'UK' },\n  carrier: 'Shipwell Air Express',\n  description: 'High value microchips'\n}, {\n  headers: { 'Authorization': 'Bearer sw_live_8291a82b9e' }\n})\n.then(res => console.log(\`Tracking ID: \${res.data.trackingId}\`))\n.catch(err => console.error(err));`;
                    } else if (devApiLang === 'python') {
                      codeText = `import requests\n\nurl = "https://api.shipwell.com/v1/shipments"\nheaders = {\n    "Authorization": "Bearer sw_live_8291a82b9e",\n    "Content-Type": "application/json"\n}\npayload = {\n    "origin": {"city": "Accra", "country": "GH"},\n    "destination": {"city": "London", "country": "UK"},\n    "carrier": "Shipwell Air Express",\n    "description": "High value microchips"\n}\n\nresponse = requests.post(url, json=payload, headers=headers)\nprint(f"Node Track Registered: {response.json().get('trackingId')}")`;
                    }
                    navigator.clipboard.writeText(codeText);
                    alert("API code block copied to clipboard!");
                  }}
                  className="absolute top-2.5 right-2.5 px-3 py-1.5 bg-bg-card hover:bg-bg-base text-[10px] text-text-muted hover:text-text-base border border-border-line rounded-lg cursor-pointer transition-colors flex items-center gap-1 font-sans"
                >
                  <Clipboard className="w-3.5 h-3.5" /> Copy Code
                </button>
              </div>

              <div className="flex gap-2.5 items-center p-3 rounded-xl border border-border-line/60 bg-bg-base">
                <Database className="w-4 h-4 text-brand-primary shrink-0" />
                <span className="text-[10px] text-text-muted leading-tight">
                  The API is connected to the same production Firestore cluster, feeding dashboard tracking screens and admin controls seamlessly. Use your corporate tokens with endpoints securely.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── SERVICE OVERLAY DETAIL MODAL ─── */}
      {serviceOverlayDetail && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-line rounded-2xl w-full max-w-md p-6 md:p-8 relative shadow-2xl animate-scale-up">
            <button 
              onClick={() => setServiceOverlayDetail(null)}
              className="absolute top-6 right-6 p-1.5 border border-border-line rounded-lg text-text-muted hover:text-text-base bg-bg-base hover:bg-bg-card transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex flex-col gap-4 text-left">
              {[
                { id: 'express', title: 'Express Overnight Lane', info: 'Primary air route dispatch network. Guarantees priority loading, customs fast-tracking pipelines, and doorstep shipping delivery in under 24 hours globally.' },
                { id: 'economy', title: 'Economy Ground Standard', info: 'The most cost-effective global alternative. Operates via optimized cargo road corridors and high-speed cargo vessels with 4-6 business day transits.' },
                { id: 'sameday', title: 'Same-Day Local Courier', info: 'Instant hyper-localized couriers. Features GPS trackable point-to-point courier delivery for high-priority files, packages and keys in less than 4 hours.' },
                { id: 'freight', title: 'Heavy Freight Logistics', info: 'LCL and FCL multi-node solutions. Dedicated shipping containers for bulk machinery, retail crates, and industrial pallet shipments globally.' },
                { id: 'intl', title: 'Global Jet Shipping', info: 'Secure air corridor delivery to 180+ sovereign borders. Backed by full priority carrier licensing, premium security boxes, and live customs agents.' },
                { id: 'customs', title: 'Customs Regulations Brokerage', info: 'Automated legal compliance filings. Custom integrations handle taxes, tariffs, declarations, import/export duties instantly so freight experiences zero delays.' }
              ].filter(x => x.id === serviceOverlayDetail).map((col) => (
                <div key={col.id} className="flex flex-col gap-3">
                  <div className="w-[44px] h-[44px] rounded-xl bg-brand-primary/10 border border-brand-primary/30 flex items-center justify-center text-brand-primary animate-scale-up">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-display font-[800] text-xl text-text-base">{col.title}</h3>
                    <span className="text-xs text-brand-primary font-mono font-bold uppercase tracking-wider">Priority Transit Configuration</span>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">
                    {col.info} Our high-security vehicles, digital containers, and licensed carrier supervisors maintain complete control of coordinates from step one to final sign-off.
                  </p>
                  <div className="bg-bg-base p-3 border border-border-line rounded-xl flex items-center justify-between mt-1 text-xs">
                    <span className="text-text-muted font-medium">Lane status check:</span>
                    <span className="font-mono font-bold text-emerald-500 uppercase flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Highly Active</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </main>
  )
}
