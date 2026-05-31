"use client";
import { ShipmentSummaryCard } from "@/components/tracking/ShipmentSummaryCard"
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline"
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { SearchX, HelpCircle } from "lucide-react";

export default function TrackingPage() {
  const params = useParams();
  const trackingNumber = (params.trackingId as string).toUpperCase();
  const [shipment, setShipment] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function fetchTracking() {
      if (!trackingNumber) return;
      try {
        // Step 1: Query shipments WHERE trackingNumber field == input
        const q = query(
          collection(db, "shipments"),
          where("trackingNumber", "==", trackingNumber)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const shipmentDoc = snap.docs[0];
        const s = shipmentDoc.data();
        
        // Step 2: Query events subcollection using shipmentDoc.id (auto ID)
        const eventsSnap = await getDocs(
          query(
            collection(db, "shipments", shipmentDoc.id, "events"),
            orderBy("occurredAt", "desc")  // newest first
          )
        );
        const evts = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        setShipment({
          status: s.status,
          carrier: s.carrier,
          trackingNumber: s.trackingNumber,
          estimatedDelivery: s.estimatedDelivery,
          origin: { city: s.originCity, state: s.originState, zip: s.originZip },
          destination: { city: s.destinationCity, state: s.destinationState, zip: s.destinationZip },
        });

        setEvents(evts.map((e: any, index: number) => ({
          ...e,
          isLatest: index === 0,
        })));
      } catch (err) {
        console.error("Tracking fetch error:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    fetchTracking();
  }, [trackingNumber]);

  if (loading) return (
    <div className="w-full max-w-[1024px] mx-auto px-10 py-20 flex justify-center items-center h-screen">
      <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (notFound) return (
    <div className="w-full bg-bg-base min-h-screen">
      <div className="bg-red-500/10 border-b border-red-500/20 py-6">
         <div className="w-full max-w-[1024px] mx-auto px-10 flex items-center gap-4 text-red-500">
            <SearchX className="w-8 h-8 flex-shrink-0" />
            <div>
               <h2 className="font-bold text-lg">Tracking number not found</h2>
               <p className="text-sm opacity-90">"{trackingNumber}" does not match any shipment.</p>
            </div>
         </div>
      </div>
      
      <div className="w-full max-w-[1024px] mx-auto px-10 py-16 flex flex-col items-center justify-center gap-4">
        <Link href="/" className="text-brand-primary hover:underline font-bold">← Back to homepage</Link>
      </div>
    </div>
  );

  const fullData = { ...shipment, events };

  return (
    <div className="w-full bg-bg-base min-h-screen">
      <div className="w-full max-w-[1024px] mx-auto px-10 py-10">
        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-10">
          <div className="md:col-span-1">
            <ShipmentSummaryCard shipment={fullData} />
          </div>
          <div className="md:col-span-1">
             <TrackingTimeline shipment={fullData} />
          </div>
        </div>
      </div>
    </div>
  )
}
