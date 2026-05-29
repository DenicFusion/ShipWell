'use client';

import { motion } from "motion/react"
import { TrackingEventData } from "@/types/tracking"
import { cn } from "@/lib/utils"

export function TimelineEvent({ event }: { event: TrackingEventData }) {
  const isException = event.eventCode === 'EXCEPTION' || event.eventCode === 'RETURN_TO_SENDER';

  return (
    <motion.div 
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
      }}
      className={`relative flex justify-between items-start ${event.isLogical ? 'opacity-80' : ''}`}
    >
      <div className={cn(
         "absolute -left-[50px] w-[18px] h-[18px] rounded-full border-[3px] border-brand-primary top-[4px] box-border",
         event.isLatest ? "bg-bg-base shadow-[0_0_15px_var(--brand-primary)]" : "bg-bg-base border-brand-primary/50"
      )}>
        {event.isLatest && (
          <div className="absolute -inset-[8px] border-[2px] border-brand-primary rounded-full opacity-40 pointer-events-none animate-ping" />
        )}
      </div>

      <div className="flex-1">
        <div className="font-bold text-[18px] mb-1 text-text-base">{event.label}</div>
        {event.facility && <div className="text-[14px] text-text-muted">{event.facility}</div>}
        {event.location && <div className="text-[14px] text-text-muted">{event.location}</div>}
      </div>

      <div className="text-right min-w-[120px]">
        <div className="font-mono font-medium text-[14px] text-text-base">{event.formattedTime}</div>
        <div className="text-[12px] text-text-muted mt-0.5">{event.formattedDate}</div>
      </div>
    </motion.div>
  )
}
