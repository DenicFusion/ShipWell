'use client';
import { ShipmentSummaryCard } from "@/components/tracking/ShipmentSummaryCard"
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline"
import { ShipmentData, ShipmentStatus } from "@/types/tracking"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import Link from "next/link"
import { SearchX, HelpCircle, PackageX } from "lucide-react"

export default function TrackingPage() {
  const params = useParams()
  const trackingId = (params.trackingId as string)?.toUpperCase();
  const [data, setData] = useState<ShipmentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTracking() {
      if (!trackingId) return;
      try {
        const docRef = doc(db, 'shipments', trackingId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const s = docSnap.data();
          // get events
          const eventsRef = collection(db, 'shipments', trackingId, 'events');
          // order events by createdAt desc
          const q = query(eventsRef, orderBy('createdAt', 'desc'));
          const eventsSnap = await getDocs(q);
          const evts = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          setData({
            status: s.status as ShipmentStatus,
            carrier: s.carrier,
            trackingNumber: s.trackingNumber,
            estimatedDelivery: s.estimatedDelivery,
            origin: { city: s.originCity, state: s.originState, zip: s.originZip },
            destination: { city: s.destinationCity, state: s.destinationState, zip: s.destinationZip },
            events: evts.map((e: any) => ({
              id: e.id,
              isLatest: e.isLatest,
              isLogical: e.isLogical,
              statusColor: e.statusColor,
              eventCode: e.eventCode,
              label: e.label,
              description: e.description,
              facility: e.facility,
              location: e.location,
              formattedDate: e.formattedDate,
              formattedTime: e.formattedTime
            }))
          });
        }
      } catch (err) {
        console.error("Error fetching shipment", err);
      } finally {
        setLoading(false);
      }
    }
    fetchTracking();
  }, [trackingId]);

  if (loading) {
    return (
      <div className="w-full max-w-[1024px] mx-auto px-10 py-20 flex justify-center items-center">
         <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="w-full bg-bg-base min-h-screen">
          <div className="bg-red-500/10 border-b border-red-500/20 py-6">
             <div className="w-full max-w-[1024px] mx-auto px-10 flex items-center gap-4 text-red-500">
                <SearchX className="w-8 h-8 flex-shrink-0" />
                <div>
                   <h2 className="font-bold text-lg">Tracking attempt not successful</h2>
                   <p className="text-sm opacity-90">Please check your tracking number ({trackingId}) and try again.</p>
                </div>
             </div>
          </div>
          
          <div className="w-full max-w-[1024px] mx-auto px-10 py-16">
            <h3 className="font-display text-2xl font-bold mb-8 text-text-base flex items-center gap-3">
               <HelpCircle className="text-brand-primary" />
               Frequently Asked Questions
            </h3>

            <div className="space-y-6 max-w-2xl">
               <div className="bg-bg-surface p-6 rounded-xl border border-border-line">
                 <h4 className="font-bold text-text-base mb-2">Why is my tracking number not found?</h4>
                 <p className="text-text-muted text-sm">
                   It can take up to 24 hours for a new tracking number to appear in our system after the shipper has created the label. If your package was recently shipped, please try again later.
                 </p>
               </div>
               <div className="bg-bg-surface p-6 rounded-xl border border-border-line">
                 <h4 className="font-bold text-text-base mb-2">What is the correct format for tracking?</h4>
                 <p className="text-text-muted text-sm">
                   Shipwell tracking numbers typically start with &quot;SW&quot; followed by 10 digits (e.g., SW1234567890). Be careful to avoid spaces or extra characters.
                 </p>
               </div>
               <div className="bg-bg-surface p-6 rounded-xl border border-border-line">
                 <h4 className="font-bold text-text-base mb-2">Still need help?</h4>
                 <p className="text-text-muted text-sm mb-4">
                   If it has been more than 24 hours and you still cannot find your tracking information, please contact our support team.
                 </p>
                 <Link href="/" className="text-sm font-bold text-brand-primary hover:underline">
                    Contact Support &rarr;
                 </Link>
               </div>
            </div>
          </div>
      </div>
    )
  }

  return (
    <div className="w-full bg-bg-base min-h-screen">
      <div className="w-full max-w-[1024px] mx-auto px-10 py-10">
        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-10">
          <div className="md:col-span-1">
            <ShipmentSummaryCard shipment={data} />
          </div>
          <div className="md:col-span-1">
             <TrackingTimeline shipment={data} />
          </div>
        </div>
      </div>
    </div>
  )
}
