import { ShipmentData } from "@/types/tracking"
import { TimelineEvent } from "./TimelineEvent"
import { motion } from "motion/react"

export function TrackingTimeline({ shipment }: { shipment: ShipmentData }) {
  if (!shipment.events || shipment.events.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border-line bg-bg-card">
        <p className="text-text-muted">No tracking events available yet.</p>
      </div>
    )
  }

  return (
    <div className="">
      <div className="border-l-[2px] border-brand-primary ml-5 pl-[40px] flex flex-col gap-[32px]">
      <motion.div 
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { staggerChildren: 0.1 } }
        }}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-[32px]"
      >
        {shipment.events.map((event) => (
          <TimelineEvent key={event.id} event={event} />
        ))}
      </motion.div>
      </div>
    </div>
  )
}