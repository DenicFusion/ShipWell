'use client';
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from "firebase/auth";
import { collection, getDocs, addDoc, doc, setDoc, query, orderBy, serverTimestamp, deleteDoc } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/firebase-errors";
import { Package, Truck, PackageCheck, AlertCircle, Plus, Trash2 } from "lucide-react";
import { ShipmentStatus } from "@/types/tracking";
import Link from "next/link";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { ShipwellLogo } from "@/components/ShipwellLogo";

export default function AdminPage() {
  // Removed Firebase Auth logic, handled by layout
  const [loadingText, setLoadingText] = useState("");
  const [shipments, setShipments] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'shipments'|'create'>('shipments');
  const [selectedShipment, setSelectedShipment] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  const fetchShipments = async () => {
    try {
      const q = query(collection(db, 'shipments'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setShipments(data);
    } catch (error) {
      console.error("Failed to list shipments:", error);
      setShipments([]);
      try {
        handleFirestoreError(error, OperationType.LIST, 'shipments');
      } catch (err: any) {
        console.warn("Firestore access error registered:", err.message);
      }
    }
  };

  useEffect(() => {
    fetchShipments();
  }, []);

  const logout = () => {
    localStorage.removeItem("sw_is_admin");
    document.cookie = "sw_is_admin=; path=/; max-age=0";
    window.location.href = "/";
  };

  const fetchEvents = async (trackingId: string) => {
    try {
      const q = query(collection(db, `shipments/${trackingId}/events`), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Failed to list shipment events:", error);
      setEvents([]);
      try {
        handleFirestoreError(error, OperationType.LIST, `shipments/${trackingId}/events`);
      } catch (err: any) {
        console.warn("Firestore access error registered:", err.message);
      }
    }
  };

  const [formData, setFormData] = useState({
    trackingNumber: "",
    status: "PENDING",
    carrier: "Shipwell Logistics",
    originCity: "", originState: "", originZip: "",
    destinationCity: "", destinationState: "", destinationZip: "",
    estimatedDelivery: ""
  });

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const docRef = doc(db, 'shipments', formData.trackingNumber);
      
      const shipmentPayload: any = {
        status: formData.status,
        carrier: formData.carrier,
        trackingNumber: formData.trackingNumber,
        originCity: formData.originCity,
        originState: formData.originState,
        originZip: formData.originZip,
        destinationCity: formData.destinationCity,
        destinationState: formData.destinationState,
        destinationZip: formData.destinationZip,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        userId: "admin"
      };
      
      if (formData.estimatedDelivery) {
         shipmentPayload.estimatedDelivery = formData.estimatedDelivery;
      }
      
      await setDoc(docRef, shipmentPayload);
      
      // Create an initial timeline event under shipments/{trackingNumber}/events
      const initialEventRef = doc(collection(db, `shipments/${formData.trackingNumber}/events`));
      await setDoc(initialEventRef, {
        isLogical: false,
        statusColor: "bg-amber-500",
        eventCode: formData.status,
        label: "Shipment Registered",
        description: `Shipment order registered. Status set to ${formData.status}.`,
        facility: "Corporate Logistics Hub",
        location: `${formData.originCity}, ${formData.originState}`,
        formattedDate: "Today",
        formattedTime: "Just Now",
        createdAt: serverTimestamp()
      });
      
      alert("Shipment created!");
      setActiveTab('shipments');
      fetchShipments();
    } catch (error) {
       console.error(error);
       alert("Error creating shipment. Ensure you are an admin.");
       handleFirestoreError(error, OperationType.CREATE, `shipments/${formData.trackingNumber}`);
    } finally {
      setCreating(false);
    }
  };

  const [eventData, setEventData] = useState({
    isLogical: false, statusColor: "bg-brand-primary",
    eventCode: "IN_TRANSIT", label: "", description: "",
    facility: "", location: "", formattedDate: "", formattedTime: ""
  });

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShipment) return;
    try {
      const newRef = doc(collection(db, `shipments/${selectedShipment}/events`));
      await setDoc(newRef, {
         ...eventData,
         createdAt: serverTimestamp()
      });
      alert("Event Added");
      fetchEvents(selectedShipment);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `shipments/${selectedShipment}/events`);
    }
  };

  const handleSeedData = async () => {
    setLoadingText("Seeding demo shipments...");
    try {
      const demoShipments = [
        {
          trackingNumber: "SW-20260530-ACC001",
          userId: null,
          status: "IN_TRANSIT",
          serviceType: "EXPRESS",
          originCity: "Accra", originCountry: "Ghana",
          destinationCity: "London", destinationCountry: "United Kingdom",
          recipientName: "James Mensah",
          recipientAddress: "14 Baker Street, London EC1A 1BB",
          weightKg: 3.2, declaredValue: 800, currency: "USD",
          taxRate: 0.20, taxAmount: 160, baseShippingFee: 75, totalAmount: 235,
          estimatedDelivery: new Date(Date.now() + 86400000 * 2),
          events: [
            {
              eventCode: "IN_TRANSIT",
              label: "In Transit — Air Freight",
              description: "Cargo loaded and departed from Accra Kotoka International Airport.",
              facilityName: "Kotoka International Airport",
              city: "Accra", country: "Ghana",
              occurredAt: new Date(Date.now() - 3600000 * 2)
            },
            {
              eventCode: "ORIGIN_ACCEPTANCE",
              label: "Accepted at Origin Facility",
              description: "Package scanned and accepted at the ShipWell Accra hub.",
              facilityName: "ShipWell Accra Hub",
              city: "Accra", country: "Ghana",
              occurredAt: new Date(Date.now() - 3600000 * 8)
            },
            {
              eventCode: "LABEL_CREATED",
              label: "Shipping Label Created",
              description: "Shipment registered in the ShipWell system.",
              facilityName: "ShipWell Portal",
              city: "Accra", country: "Ghana",
              occurredAt: new Date(Date.now() - 3600000 * 10)
            }
          ]
        },
        {
          trackingNumber: "SW-20260528-LOS002",
          userId: null,
          status: "OUT_FOR_DELIVERY",
          serviceType: "STANDARD",
          originCity: "Lagos", originCountry: "Nigeria",
          destinationCity: "New York", destinationCountry: "United States",
          recipientName: "Sarah Williams",
          recipientAddress: "55 Water Street, New York NY 10041",
          weightKg: 1.5, declaredValue: 300, currency: "USD",
          taxRate: 0.085, taxAmount: 25.5, baseShippingFee: 45, totalAmount: 70.5,
          estimatedDelivery: new Date(Date.now() + 86400000 * 1),
          events: [
            {
              eventCode: "OUT_FOR_DELIVERY",
              label: "Out for Delivery",
              description: "Package is with the delivery courier and will arrive today.",
              facilityName: "ShipWell NYC Last-Mile Hub",
              city: "New York", country: "United States",
              occurredAt: new Date(Date.now() - 3600000 * 1)
            },
            {
              eventCode: "ARRIVED_AT_UNIT",
              label: "Arrived at Delivery Unit",
              description: "Package arrived at local delivery unit for final dispatch.",
              facilityName: "NYC Delivery Unit",
              city: "New York", country: "United States",
              occurredAt: new Date(Date.now() - 3600000 * 5)
            },
            {
              eventCode: "IN_TRANSIT",
              label: "In Transit",
              description: "Package in transit from JFK sorting facility.",
              facilityName: "JFK International Sorting",
              city: "New York", country: "United States",
              occurredAt: new Date(Date.now() - 3600000 * 12)
            },
            {
              eventCode: "LABEL_CREATED",
              label: "Shipping Label Created",
              description: "Shipment registered in the ShipWell system.",
              facilityName: "ShipWell Lagos Hub",
              city: "Lagos", country: "Nigeria",
              occurredAt: new Date(Date.now() - 86400000 * 3)
            }
          ]
        },
        {
          trackingNumber: "SW-20260525-KUM003",
          userId: null,
          status: "DELIVERED",
          serviceType: "ECONOMY",
          originCity: "Kumasi", originCountry: "Ghana",
          destinationCity: "Berlin", destinationCountry: "Germany",
          recipientName: "Klaus Mueller",
          recipientAddress: "Unter den Linden 1, 10117 Berlin",
          weightKg: 5.0, declaredValue: 1200, currency: "EUR",
          taxRate: 0.19, taxAmount: 228, baseShippingFee: 90, totalAmount: 318,
          estimatedDelivery: new Date(Date.now() - 86400000 * 1),
          events: [
            {
              eventCode: "DELIVERED",
              label: "Delivered",
              description: "Package successfully delivered to the recipient. Signed by: K. Mueller",
              facilityName: null,
              city: "Berlin", country: "Germany",
              occurredAt: new Date(Date.now() - 86400000 * 1)
            },
            {
              eventCode: "OUT_FOR_DELIVERY",
              label: "Out for Delivery",
              description: "Package is with the delivery courier.",
              facilityName: "Berlin Last-Mile Hub",
              city: "Berlin", country: "Germany",
              occurredAt: new Date(Date.now() - 86400000 * 1 - 3600000 * 3)
            },
            {
              eventCode: "ARRIVED_AT_FACILITY",
              label: "Arrived at Facility",
              description: "Package arrived at Berlin sorting facility.",
              facilityName: "Berlin Air Cargo Center",
              city: "Berlin", country: "Germany",
              occurredAt: new Date(Date.now() - 86400000 * 2)
            },
            {
              eventCode: "IN_TRANSIT",
              label: "In Transit",
              description: "Package in transit from Frankfurt hub.",
              facilityName: "Frankfurt International Hub",
              city: "Frankfurt", country: "Germany",
              occurredAt: new Date(Date.now() - 86400000 * 3)
            },
            {
              eventCode: "LABEL_CREATED",
              label: "Shipping Label Created",
              description: "Shipment registered in the ShipWell system.",
              facilityName: "ShipWell Kumasi Hub",
              city: "Kumasi", country: "Ghana",
              occurredAt: new Date(Date.now() - 86400000 * 7)
            }
          ]
        }
      ];

      for (const shipment of demoShipments) {
        const { events, ...shipmentData } = shipment;
        
        // Use addDoc for auto-ID — NEVER use trackingNumber as doc ID
        const shipmentRef = await addDoc(collection(db, "shipments"), {
          ...shipmentData,
          estimatedDelivery: shipmentData.estimatedDelivery,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // Write events to subcollection using shipmentRef.id
        for (const event of events) {
          await addDoc(collection(db, "shipments", shipmentRef.id, "events"), {
            ...event,
            occurredAt: event.occurredAt,
            createdAt: serverTimestamp(),
            isLogical: false,
          });
        }
      }

      alert("✅ 3 demo shipments seeded! Tracking codes:\n• SW-20260530-ACC001\n• SW-20260528-LOS002\n• SW-20260525-KUM003");
      fetchShipments();
    } catch (error: any) {
      console.error("Seed error:", error);
      alert("❌ Seed failed: " + error.message);
    } finally {
      setLoadingText("");
    }
  };

  if (loadingText) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-base">
        <div className="flex flex-col items-center gap-3 bg-bg-surface border border-border-line p-8 rounded-2xl max-w-sm text-center">
          <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold tracking-wide">{loadingText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-bg-base flex flex-col">
       <header className="border-b border-border-line/50 bg-bg-surface/80 backdrop-blur-md">
        <div className="flex h-16 items-center px-6 justify-between">
          <div className="flex items-center gap-4">
             <Link href="/">
                <ShipwellLogo />
             </Link>
             <span className="bg-red-500/10 text-red-500 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-widest hidden sm:inline-block">Admin Mode</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-text-muted">admin@shipwell.com</span>
            <ThemeSwitch />
            <button onClick={logout} className="text-sm font-semibold text-text-muted hover:text-brand-primary">Logout</button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="w-64 border-r border-border-line bg-bg-surface p-6 hidden md:block">
           <nav className="space-y-2">
             <button onClick={() => setActiveTab('shipments')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-colors ${activeTab === 'shipments' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-muted hover:bg-border-line/30'}`}>
               <Package className="w-4 h-4" /> Shipments
             </button>
             <button onClick={() => setActiveTab('create')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-colors ${activeTab === 'create' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-muted hover:bg-border-line/30'}`}>
               <Plus className="w-4 h-4" /> New Shipment
             </button>
           </nav>
        </aside>
        
        <main className="flex-1 p-6 md:p-10 overflow-auto">
           {activeTab === 'shipments' && !selectedShipment && (
             <div>
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                 <h1 className="text-2xl font-bold">Manage Shipments</h1>
                 <button 
                   onClick={handleSeedData} 
                   className="px-4 py-2 border border-brand-primary/30 bg-brand-primary/10 text-brand-primary text-xs font-bold rounded-lg hover:bg-brand-primary/20 transition-all flex items-center gap-1.5 cursor-pointer text-center"
                 >
                   Seed Demo Shipments
                 </button>
               </div>
               <div className="grid gap-4">
                 {shipments.map(s => (
                   <div key={s.id} className="bg-bg-surface border border-border-line rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                     <div>
                       <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-bold text-lg">{s.trackingNumber}</h3>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-border-line/50 text-text-base">
                             {s.status}
                          </span>
                       </div>
                       <p className="text-sm text-text-muted ">{s.originCity}, {s.originState} &rarr; {s.destinationCity}, {s.destinationState}</p>
                     </div>
                     <div className="flex gap-3">
                        <Link target="_blank" href={`/track/${s.trackingNumber}`} className="px-4 py-2 rounded-lg bg-border-line/30 text-sm font-bold hover:bg-border-line/50 transition">View Public</Link>
                        <button onClick={() => { setSelectedShipment(s.id); fetchEvents(s.id); }} className="px-4 py-2 rounded-lg bg-brand-primary text-white text-sm font-bold hover:opacity-90 transition">Manage Events</button>
                     </div>
                   </div>
                 ))}
               </div>
             </div>
           )}

           {activeTab === 'create' && (
             <div className="max-w-2xl">
               <h1 className="text-2xl font-bold mb-6">Create New Shipment</h1>
               <form onSubmit={handleCreateShipment} className="space-y-6 bg-bg-surface border border-border-line p-8 rounded-xl">
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-xs font-bold text-text-muted uppercase mb-2">Tracking Number</label>
                     <input required placeholder="e.g. SW293847" className="w-full bg-bg-base border border-border-line p-3 rounded-lg focus:outline-none focus:border-brand-primary" value={formData.trackingNumber} onChange={e => setFormData({...formData, trackingNumber: e.target.value.toUpperCase()})} />
                   </div>
                   <div>
                     <label className="block text-xs font-bold text-text-muted uppercase mb-2">Status</label>
                     <select required className="w-full bg-bg-base border border-border-line p-3 rounded-lg focus:outline-none focus:border-brand-primary" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                       <option>PENDING</option>
                       <option>IN_TRANSIT</option>
                       <option>OUT_FOR_DELIVERY</option>
                       <option>DELIVERED</option>
                       <option>EXCEPTION</option>
                       <option>RETURNED</option>
                     </select>
                   </div>
                   <div className="col-span-2">
                     <label className="block text-xs font-bold text-text-muted uppercase mb-2">Estimated Delivery Date (Optional)</label>
                     <input type="date" className="w-full bg-bg-base border border-border-line p-3 rounded-lg focus:outline-none focus:border-brand-primary" onChange={e => {
                        if (e.target.value) {
                           setFormData({...formData, estimatedDelivery: new Date(e.target.value).toISOString()});
                        } else {
                           const { estimatedDelivery, ...rest } = formData as any;
                           setFormData(rest as any);
                        }
                     }} />
                   </div>
                 </div>

                 <div className="grid grid-cols-3 gap-4">
                   <div className="col-span-3 font-bold text-sm text-brand-primary pt-4 border-t border-border-line">Origin Details</div>
                   <div><input required placeholder="City" className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm" onChange={e=>setFormData({...formData, originCity: e.target.value})} /></div>
                   <div><input required placeholder="State (e.g. CA)" className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm" onChange={e=>setFormData({...formData, originState: e.target.value})} /></div>
                   <div><input required placeholder="Zip" className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm" onChange={e=>setFormData({...formData, originZip: e.target.value})} /></div>
                 </div>

                 <div className="grid grid-cols-3 gap-4">
                   <div className="col-span-3 font-bold text-sm text-brand-primary pt-4 border-t border-border-line">Destination Details</div>
                   <div><input required placeholder="City" className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm" onChange={e=>setFormData({...formData, destinationCity: e.target.value})} /></div>
                   <div><input required placeholder="State (e.g. NY)" className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm" onChange={e=>setFormData({...formData, destinationState: e.target.value})} /></div>
                   <div><input required placeholder="Zip" className="w-full bg-bg-base border border-border-line p-3 rounded-lg text-sm" onChange={e=>setFormData({...formData, destinationZip: e.target.value})} /></div>
                 </div>

                 <button disabled={creating} className="w-full bg-brand-primary text-white font-bold py-4 rounded-xl hover:opacity-90 disabled:opacity-50 mt-6">
                   {creating ? 'Creating...' : 'Create Shipment'}
                 </button>
               </form>
             </div>
           )}

           {selectedShipment && (
             <div>
                <button onClick={() => setSelectedShipment(null)} className="text-sm font-bold text-text-muted hover:text-brand-primary mb-6 flex items-center gap-2">&larr; Back to Shipments</button>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  <div>
                    <h2 className="text-xl font-bold mb-4">Add Tracking Event</h2>
                    <form onSubmit={handleAddEvent} className="space-y-4 bg-bg-surface border border-border-line p-6 rounded-xl">
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-bold text-text-muted uppercase mb-2">Event Code</label>
                           <input required className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" placeholder="e.g. IN_TRANSIT" onChange={e=>setEventData({...eventData, eventCode: e.target.value})} />
                         </div>
                         <div>
                           <label className="block text-xs font-bold text-text-muted uppercase mb-2">Label</label>
                           <input required className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" placeholder="e.g. Arrived at Facility" onChange={e=>setEventData({...eventData, label: e.target.value})} />
                         </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-text-muted uppercase mb-2">Description</label>
                        <textarea required className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" rows={2} onChange={e=>setEventData({...eventData, description: e.target.value})} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-bold text-text-muted uppercase mb-2">Location</label>
                           <input className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" placeholder="optional" onChange={e=>setEventData({...eventData, location: e.target.value})} />
                         </div>
                         <div>
                           <label className="block text-xs font-bold text-text-muted uppercase mb-2">Facility</label>
                           <input className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" placeholder="optional" onChange={e=>setEventData({...eventData, facility: e.target.value})} />
                         </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-bold text-text-muted uppercase mb-2">Date String</label>
                           <input className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" placeholder="e.g. Today" onChange={e=>setEventData({...eventData, formattedDate: e.target.value})} />
                         </div>
                         <div>
                           <label className="block text-xs font-bold text-text-muted uppercase mb-2">Time String</label>
                           <input className="w-full bg-bg-base border border-border-line p-2.5 rounded-lg text-sm" placeholder="e.g. 10:30 AM" onChange={e=>setEventData({...eventData, formattedTime: e.target.value})} />
                         </div>
                      </div>
                      <button className="w-full bg-brand-primary text-white font-bold py-3 rounded-lg hover:opacity-90 mt-4">
                         Push Event
                      </button>
                    </form>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold mb-4">Event History</h2>
                    <div className="space-y-3">
                       {events.map(ev => (
                         <div key={ev.id} className="bg-bg-surface border border-border-line p-4 rounded-xl text-sm">
                            <div className="flex justify-between items-start mb-2">
                               <strong className="text-text-base">{ev.label}</strong>
                               <span className="text-xs text-text-muted">{ev.formattedDate} {ev.formattedTime}</span>
                            </div>
                            <p className="text-text-muted mb-2">{ev.description}</p>
                            <div className="flex gap-2">
                               {ev.location && <span className="bg-border-line/50 px-2 py-0.5 rounded text-xs">{ev.location}</span>}
                               {ev.facility && <span className="bg-border-line/50 px-2 py-0.5 rounded text-xs">{ev.facility}</span>}
                            </div>
                         </div>
                       ))}
                       {events.length === 0 && <p className="text-text-muted text-sm italic">No events recorded.</p>}
                    </div>
                  </div>
                </div>
             </div>
           )}
        </main>
      </div>
    </div>
  );
}
