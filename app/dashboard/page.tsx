'use client';

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  doc, 
  setDoc, 
  serverTimestamp,
  addDoc
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/firebase-errors";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Truck, 
  Package, 
  Clock, 
  Search, 
  Plus, 
  HelpCircle, 
  AlertCircle, 
  CheckCircle2, 
  MapPin, 
  ChevronRight, 
  FileText, 
  Loader2,
  Calendar,
  DollarSign,
  UserCheck,
  Send
} from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  
  // States
  const [shipments, setShipments] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'booking' | 'support'>('overview');

  // New Booking Form States
  const [bookingCarrier, setBookingCarrier] = useState("Shipwell Express");
  const [bookingOriginCity, setBookingOriginCity] = useState("");
  const [bookingOriginState, setBookingOriginState] = useState("");
  const [bookingOriginZip, setBookingOriginZip] = useState("");
  const [bookingDestCity, setBookingDestCity] = useState("");
  const [bookingDestState, setBookingDestState] = useState("");
  const [bookingDestZip, setBookingDestZip] = useState("");
  const [bookingEstDelivery, setBookingEstDelivery] = useState("");
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingSuccessId, setBookingSuccessId] = useState<string | null>(null);

  // New Support Ticket Form States
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketCategory, setTicketCategory] = useState("Shipment Delay");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketSuccess, setTicketSuccess] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        fetchUserShipments(u.uid);
        fetchUserTickets(u.uid);
      }
    });
    return unsubscribe;
  }, []);

  const fetchUserShipments = async (uid: string) => {
    setLoadingShipments(true);
    try {
      const q = query(
        collection(db, "shipments"), 
        where("userId", "==", uid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setShipments(data);
    } catch (err: any) {
      console.warn("Unable to read user-linked shipments (checking fallback/index parameters)", err);
      // Fallback: list all shipments if custom index isn't completely built on Firestore yet
      try {
        const qAlt = query(collection(db, "shipments"), orderBy("createdAt", "desc"));
        const snap = await getDocs(qAlt);
        const data = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((item: any) => item.userId === uid);
        setShipments(data);
      } catch (errAlt) {
        handleFirestoreError(errAlt, OperationType.LIST, "shipments");
      }
    } finally {
      setLoadingShipments(false);
    }
  };

  const fetchUserTickets = async (uid: string) => {
    setLoadingTickets(true);
    try {
      const q = query(
        collection(db, "tickets"),
        where("userId", "==", uid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTickets(data);
    } catch (err: any) {
      console.warn("Tickets collections read parameters warning. Initializing fallback schema state.", err);
      // Empty ticket schema fallbacks
      setTickets([]);
    } finally {
      setLoadingTickets(false);
    }
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBookingSubmitting(true);
    setBookingSuccessId(null);

    const suffix = Math.floor(Math.random() * 1000000).toString(16).toUpperCase();
    const trackingCode = `SW-${suffix}`;

    try {
      const shipmentRef = doc(db, "shipments", trackingCode);
      const shipmentPayload: any = {
        userId: user.uid,
        status: "PENDING",
        carrier: bookingCarrier,
        trackingNumber: trackingCode,
        originCity: bookingOriginCity,
        originState: bookingOriginState,
        originZip: bookingOriginZip,
        destinationCity: bookingDestCity,
        destinationState: bookingDestState,
        destinationZip: bookingDestZip,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (bookingEstDelivery) {
        shipmentPayload.estimatedDelivery = new Date(bookingEstDelivery).toISOString();
      }

      // Add to Firestore index
      await setDoc(shipmentRef, shipmentPayload);

      // Create initial timeline event under subcollection shipments/{trackingCode}/events/{eventId}
      const initialEventRef = doc(collection(db, `shipments/${trackingCode}/events`));
      await setDoc(initialEventRef, {
        isLogical: false,
        statusColor: "bg-emerald-500",
        eventCode: "PENDING",
        label: "Shipment registered successfully",
        description: "The sender created a digital shipping order label. Shipwell Logistics will collect the cargo shortly.",
        facility: "Electronic Portal Gateway",
        location: `${bookingOriginCity}, ${bookingOriginState}`,
        formattedDate: "Today",
        formattedTime: "Just Now",
        createdAt: serverTimestamp()
      });

      setBookingSuccessId(trackingCode);
      
      // Clear fields
      setBookingOriginCity("");
      setBookingOriginState("");
      setBookingOriginZip("");
      setBookingDestCity("");
      setBookingDestState("");
      setBookingDestZip("");
      setBookingEstDelivery("");
      
      // Refresh shipments list
      fetchUserShipments(user.uid);
    } catch (err: any) {
      console.error("Booking error:", err);
      handleFirestoreError(err, OperationType.CREATE, `shipments/${trackingCode}`);
    } finally {
      setBookingSubmitting(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setTicketSubmitting(true);
    setTicketSuccess(false);

    try {
      const ticketId = `TICKET-${Math.floor(Math.random() * 100000).toString()}`;
      await setDoc(doc(db, "tickets", ticketId), {
        ticketId,
        userId: user.uid,
        userName: user.displayName || "Customer",
        userEmail: user.email,
        subject: ticketSubject,
        category: ticketCategory,
        message: ticketMessage,
        status: "OPEN",
        createdAt: serverTimestamp()
      });

      setTicketSuccess(true);
      setTicketSubject("");
      setTicketMessage("");
      
      // Refresh tickets
      fetchUserTickets(user.uid);
    } catch (err: any) {
      console.error("Ticket logging error:", err);
      handleFirestoreError(err, OperationType.CREATE, "tickets");
    } finally {
      setTicketSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-10 select-none">
      
      {/* Dynamic Header Section */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-[24px] border-b border-border-line/45">
        <div>
          <h1 className="font-display font-[800] text-3xl sm:text-4xl text-text-base tracking-tight uppercase leading-none">
            Workspace Overview
          </h1>
          <p className="text-xs text-text-muted mt-2 leading-relaxed">
            Monitor active dispatches, schedule direct cargo bookings, and access rapid lane support.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={() => setActiveTab('booking')}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold tracking-wide uppercase transition-colors flex items-center gap-1.5 cursor-pointer border ${activeTab === 'booking' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/35' : 'bg-bg-card border-border-line text-text-base hover:border-brand-primary/30'}`}
          >
            <Plus className="w-4 h-4 text-brand-primary shrink-0" />
            <span>Book dispatch</span>
          </button>
          <button 
            onClick={() => setActiveTab('support')}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold tracking-wide uppercase transition-colors flex items-center gap-1.5 cursor-pointer border ${activeTab === 'support' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/35' : 'bg-bg-card border-border-line text-text-base hover:border-brand-primary/30'}`}
          >
            <HelpCircle className="w-4 h-4 text-brand-primary shrink-0" />
            <span>Lodge support ticket</span>
          </button>
        </div>
      </section>

      {/* Tabs navigation */}
      <div className="flex gap-2 border-b border-border-line/30 pb-px">
        <button 
          onClick={() => { setActiveTab('overview'); setBookingSuccessId(null); setTicketSuccess(false); }}
          className={`px-5 py-2.5 border-b-[2px] text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'overview' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-text-muted hover:text-text-base'}`}
        >
          Active dispatches ({shipments.length})
        </button>
        <button 
          onClick={() => { setActiveTab('booking'); setBookingSuccessId(null); }}
          className={`px-5 py-2.5 border-b-[2px] text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'booking' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-text-muted hover:text-text-base'}`}
        >
          Cargo booking form
        </button>
        <button 
          onClick={() => { setActiveTab('support'); setTicketSuccess(false); }}
          className={`px-5 py-2.5 border-b-[2px] text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'support' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-text-muted hover:text-text-base'}`}
        >
          Customer tickets ({tickets.length})
        </button>
      </div>

      {/* OVERVIEW PANEL */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-8 animate-fade-in">
          
          {/* Quick Metrics Bento Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-bg-card border border-border-line rounded-xl p-5 flex items-center gap-4 relative overflow-hidden group">
              <div className="w-[42px] h-[42px] rounded-lg bg-emerald-950/20 border border-brand-primary/20 flex items-center justify-center font-bold text-brand-primary text-lg">
                {shipments.length}
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Total Shipments</span>
                <p className="font-display font-[800] text-lg text-text-base leading-none mt-1">Live tracking nodes</p>
              </div>
            </div>

            <div className="bg-bg-card border border-border-line rounded-xl p-5 flex items-center gap-4 relative overflow-hidden group">
              <div className="w-[42px] h-[42px] rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center font-bold text-brand-primary text-lg">
                {shipments.filter(s => s.status === "IN_TRANSIT" || s.status === "OUT_FOR_DELIVERY").length}
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">In-Flight Carrier</span>
                <p className="font-display font-[800] text-lg text-text-base leading-none mt-1">Packages in transit</p>
              </div>
            </div>

            <div className="bg-bg-card border border-border-line rounded-xl p-5 flex items-center gap-4 relative overflow-hidden group">
              <div className="w-[42px] h-[42px] rounded-lg bg-emerald-950/25 border border-brand-primary/20 flex items-center justify-center font-bold text-brand-primary text-lg">
                {tickets.filter(t => t.status === "OPEN").length}
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Open Support cases</span>
                <p className="font-display font-[800] text-lg text-text-base leading-none mt-1">Pending verification</p>
              </div>
            </div>
          </div>

          {/* List of Shipments */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-[800] text-base uppercase text-text-base tracking-tight flex items-center gap-2">
                <Truck className="w-5 h-5 text-brand-primary shrink-0" />
                <span>My Registered Shipments</span>
              </h3>
              <span className="text-[10px] font-semibold text-text-muted uppercase">Showing latest dispatches</span>
            </div>

            {loadingShipments ? (
              <div className="bg-bg-card border border-border-line rounded-2xl p-16 flex flex-col justify-center items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
                <span className="text-xs text-text-muted font-medium">Scanning logistics nodes...</span>
              </div>
            ) : shipments.length === 0 ? (
              <div className="bg-bg-card border border-border-dashed border-border-line rounded-2xl py-20 px-8 text-center flex flex-col items-center gap-5">
                <div className="w-16 h-16 rounded-full bg-border-line/30 flex items-center justify-center text-text-muted">
                  <Package className="w-8 h-8" />
                </div>
                <div className="flex flex-col gap-1.5 max-w-sm">
                  <h4 className="font-display font-[800] text-lg text-text-base">No shipments tracked</h4>
                  <p className="text-xs text-text-muted leading-relaxed">
                    You haven&apos;t scheduled or registered any cargo loads under this account UID. Launch the cargo booking form to try it out!
                  </p>
                </div>
                <button 
                  onClick={() => setActiveTab('booking')}
                  className="bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold tracking-wider uppercase py-3.5 px-6 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg shadow-brand-primary/10 transition-colors"
                >
                  <Plus className="w-4 h-4 shrink-0" /> Create shipment booking
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {shipments.map((shipment) => {
                  const statusColors = {
                    bg: shipment.status === "DELIVERED" ? "rgba(16,185,129,0.1)" : shipment.status === "PENDING" ? "rgba(100,116,139,0.1)" : "rgba(245,158,11,0.1)",
                    border: shipment.status === "DELIVERED" ? "border-emerald-500/20 text-emerald-500" : shipment.status === "PENDING" ? "border-slate-500/20 text-text-muted" : "border-amber-500/20 text-amber-500"
                  };
                  return (
                    <div 
                      key={shipment.id}
                      className="bg-bg-card border border-border-line hover:border-brand-primary/25 rounded-xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all duration-300"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <strong className="font-mono text-base font-bold text-text-base tracking-tight select-all">
                            {shipment.trackingNumber}
                          </strong>
                          <span className={`px-2.5 py-0.5 border rounded-full text-[10px] font-[800] uppercase tracking-wider ${statusColors.border}`} style={{ backgroundColor: statusColors.bg }}>
                            {shipment.status}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-brand-primary" /> {shipment.originCity} &rarr; {shipment.destinationCity}</span>
                          <span className="text-border-line">|</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Registered: {shipment.createdAt?.toDate ? shipment.createdAt.toDate().toLocaleDateString() : "Just now"}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
                        <Link 
                          href={`/track/${shipment.trackingNumber}`}
                          className="px-4 py-2 bg-bg-base hover:bg-bg-card text-text-base border border-border-line text-xs font-bold tracking-wide uppercase rounded-lg transition-colors flex items-center gap-1.5 decoration-transparent"
                        >
                          <span>Track details</span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* BOOKING PANEL */}
      {activeTab === 'booking' && (
        <div className="max-w-2xl bg-bg-card border border-border-line rounded-2xl p-6 sm:p-8 animate-fade-in">
          
          <div className="mb-6">
            <h3 className="font-display font-[800] text-xl text-text-base uppercase tracking-tight">Cargo Booking Form</h3>
            <p className="text-xs text-text-muted mt-1">
              Provide carrier specs and lane origins to register a high-precision shipment instantly in Firestore database.
            </p>
          </div>

          {bookingSuccessId ? (
            <div className="flex flex-col items-center text-center py-6 gap-6 animate-scale-up">
              <div className="w-14 h-14 rounded-full bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="flex flex-col gap-1.5 max-w-sm">
                <h4 className="font-display font-[800] text-xl text-text-base uppercase">Shipment Booked successfully!</h4>
                <p className="text-xs text-text-muted leading-relaxed">
                  Your tracking identification token has been successfully registered in the Firestore platform.
                </p>
              </div>
              <div className="bg-bg-base border-2 border-dashed border-brand-primary/40 px-6 py-4 rounded-xl text-brand-primary font-mono text-lg font-bold select-all tracking-wider relative group">
                {bookingSuccessId}
              </div>
              <div className="flex gap-3 w-full">
                <Link 
                  href={`/track/${bookingSuccessId}`}
                  className="flex-1 bg-brand-primary hover:bg-brand-primary-hover text-white text-center py-3.5 rounded-xl text-xs font-bold tracking-wider uppercase decoration-transparent cursor-pointer"
                >
                  Configure and Track live
                </Link>
                <button 
                  onClick={() => setBookingSuccessId(null)}
                  className="flex-1 bg-bg-base border border-border-line text-text-base hover:bg-bg-base py-3.5 rounded-xl text-xs font-bold tracking-wider uppercase cursor-pointer"
                >
                  Book another parcel
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateBooking} className="space-y-6">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Logistics Carrier Agency</label>
                  <select 
                    value={bookingCarrier}
                    onChange={(e) => setBookingCarrier(e.target.value)}
                    className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                  >
                    <option value="Shipwell Logistics Ltd">Shipwell Logistics Priority</option>
                    <option value="Shipwell Air Cargo">Shipwell Air Cargo Express</option>
                    <option value="Shipwell Overland Lanes">Shipwell Overland Freight</option>
                  </select>
                </div>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Estimated delivery Target (Optional)</label>
                  <input 
                    type="date" 
                    value={bookingEstDelivery}
                    onChange={(e) => setBookingEstDelivery(e.target.value)}
                    className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary font-mono"
                  />
                </div>
              </div>

              {/* Origin Grid */}
              <div className="space-y-2 border-t border-border-line/40 pt-4">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">Lanes Origin Location</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-text-muted">City</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. Accra" 
                      value={bookingOriginCity}
                      onChange={(e) => setBookingOriginCity(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-medium focus:outline-none text-text-base focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-text-muted">State / Region</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. Greater" 
                      value={bookingOriginState}
                      onChange={(e) => setBookingOriginState(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-medium focus:outline-none text-text-base focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-text-muted">Zip code</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. GA-293" 
                      value={bookingOriginZip}
                      onChange={(e) => setBookingOriginZip(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-medium focus:outline-none text-text-base focus:border-brand-primary font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Destination Grid */}
              <div className="space-y-2 border-t border-border-line/40 pt-4">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">Lanes Destination Location</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-text-muted">City</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. London" 
                      value={bookingDestCity}
                      onChange={(e) => setBookingDestCity(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-medium focus:outline-none text-text-base focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-text-muted">State / Region</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. London" 
                      value={bookingDestState}
                      onChange={(e) => setBookingDestState(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-medium focus:outline-none text-text-base focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-text-muted">Zip code</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. EC1A" 
                      value={bookingDestZip}
                      onChange={(e) => setBookingDestZip(e.target.value)}
                      className="bg-bg-base border border-border-line p-3 rounded-lg text-xs font-medium focus:outline-none text-text-base focus:border-brand-primary font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border-line/40">
                <button 
                  type="submit"
                  disabled={bookingSubmitting}
                  className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold tracking-wider uppercase py-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-primary/15 transition-colors"
                >
                  {bookingSubmitting ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Package className="w-4 h-4 text-white" />}
                  <span>Register and schedule dispatch</span>
                </button>
              </div>

            </form>
          )}

        </div>
      )}

      {/* SUPPORT PANEL */}
      {activeTab === 'support' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 animate-fade-in">
          
          {/* New Ticket form */}
          <div className="bg-bg-card border border-border-line rounded-2xl p-6 sm:p-8">
            <div className="mb-6">
              <h3 className="font-display font-[800] text-xl text-text-base uppercase tracking-tight">Lodge Support Ticket</h3>
              <p className="text-xs text-text-muted mt-1">
                Lodge immediate assist queries directly to our compliance brokers and support center.
              </p>
            </div>

            {ticketSuccess ? (
              <div className="bg-brand-primary/10 border border-brand-primary/20 text-text-base p-6 rounded-xl flex flex-col items-center text-center gap-3 animate-scale-up">
                <CheckCircle2 className="w-10 h-10 text-brand-primary" />
                <div className="flex flex-col">
                  <span className="font-bold text-sm uppercase">Support ticket registered!</span>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">
                    Our compliance lanes dispatch assistant will review your query and respond directly.
                  </p>
                </div>
                <button 
                  onClick={() => setTicketSuccess(false)}
                  className="bg-bg-base text-text-base border border-border-line text-xs font-bold tracking-wide uppercase px-4 py-2 rounded-lg mt-3"
                >
                  Lodge new ticket
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateTicket} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Ticket Category</label>
                    <select 
                      value={ticketCategory}
                      onChange={(e) => setTicketCategory(e.target.value)}
                      className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                    >
                      <option value="Shipment Delay">Shipment Delay</option>
                      <option value="Brokerage Duties">Brokerage & Duties</option>
                      <option value="Address correction">Address correction</option>
                      <option value="Lost cargo help">Lost cargo assist</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Subject Heading</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Customs delays Accra LHR" 
                      value={ticketSubject}
                      onChange={(e) => setTicketSubject(e.target.value)}
                      className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Details explaining event</label>
                  <textarea 
                    required 
                    rows={4}
                    placeholder="Provide full description (include package tracking code if relevant)..." 
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm text-text-base focus:outline-none focus:border-brand-primary leading-relaxed"
                  />
                </div>

                <button 
                  type="submit"
                  disabled={ticketSubmitting}
                  className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold tracking-wider uppercase py-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-primary/10 transition-colors"
                >
                  {ticketSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>Lodge support case</span>
                </button>
              </form>
            )}

          </div>

          {/* Ticket history log */}
          <div className="space-y-4">
            <h3 className="font-display font-[800] text-base uppercase text-text-base tracking-tight flex items-center gap-2">
              <HelpCircle className="text-brand-primary w-5 h-5" />
              <span>Lodge tickets logs ({tickets.length})</span>
            </h3>

            {loadingTickets ? (
              <div className="bg-bg-card border border-border-line rounded-2xl p-10 flex flex-col justify-center items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
                <span className="text-xs text-text-muted font-medium">Scanning ticket systems...</span>
              </div>
            ) : tickets.length === 0 ? (
              <p className="text-xs text-text-muted italic bg-bg-card p-6 border border-border-line rounded-xl text-center">
                No tickets lodged under this user dashboard.
              </p>
            ) : (
              <div className="space-y-3">
                {tickets.map((t) => (
                  <div key={t.id} className="bg-bg-card border border-border-line p-5 rounded-xl flex flex-col gap-3">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex flex-col">
                        <strong className="text-sm font-semibold text-text-base leading-tight">
                          {t.subject}
                        </strong>
                        <span className="text-[10px] font-bold text-brand-primary uppercase mt-1">
                          {t.category}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-brand-primary">
                        {t.status}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed line-clamp-3 bg-bg-base/50 border border-border-line/40 rounded-lg p-3">
                      {t.message}
                    </p>
                    <span className="text-[9px] font-mono text-text-muted text-right">
                      UID: {t.ticketId}
                    </span>
                  </div>
                ))}
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
}
