import { ShipmentData, ShipmentStatus } from "@/types/tracking"
import { format } from "date-fns"

export function ShipmentSummaryCard({ shipment }: { shipment: ShipmentData }) {
  const isWarning = shipment.status === ShipmentStatus.IN_TRANSIT || shipment.status === ShipmentStatus.OUT_FOR_DELIVERY;
  const isDelivered = shipment.status === ShipmentStatus.DELIVERED;
  const isException = shipment.status === ShipmentStatus.EXCEPTION || shipment.status === ShipmentStatus.RETURNED;
  
  const statusColors = {
    bg: isWarning ? 'rgba(245, 158, 11, 0.1)' : isException ? 'rgba(239, 68, 68, 0.1)' : isDelivered ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
    border: isWarning ? 'var(--color-brand-warning)' : isException ? 'var(--color-brand-danger)' : isDelivered ? 'var(--color-brand-success)' : 'var(--color-brand-muted)',
    text: isWarning ? 'var(--color-brand-warning)' : isException ? 'var(--color-brand-danger)' : isDelivered ? 'var(--color-brand-success)' : 'var(--color-brand-muted)'
  };

  return (
    <div className="rounded-[20px] border border-border-line bg-bg-card p-6 backdrop-blur-sm sticky top-[100px]">
      <div className="flex flex-col gap-5">
        <div>
           <div 
             className="px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-[0.5px] w-fit border"
             style={{ backgroundColor: statusColors.bg, borderColor: statusColors.border, color: statusColors.text }}
           >
             {shipment.status.replace(/_/g, ' ')}
           </div>
           <div className="font-mono text-[13px] text-text-muted break-all mt-3">
              ID: {shipment.trackingNumber}
            </div>
        </div>

        <div className="h-px bg-border-line w-full" />

        <div>
          <div className="text-[14px] text-text-muted mb-1">Destination</div>
          <div className="text-[20px] font-bold text-text-base leading-tight">
            {shipment.destination.city}, {shipment.destination.state} {shipment.destination.zip}
          </div>
          {shipment.estimatedDelivery && (
             <div className="text-[14px] text-text-muted mt-1">Scheduled: {format(new Date(shipment.estimatedDelivery), 'MMM dd, yyyy')}</div>
          )}
        </div>

        <div className="h-px bg-border-line w-full" />

        <div>
           <div className="text-[14px] text-text-muted mb-1">Service Type</div>
           <div className="text-[16px] font-medium text-text-base">{shipment.carrier} Priority Express</div>
        </div>

        <div className="mt-4 rounded-[12px] bg-border-line p-4 border border-border-line">
           <div className="text-[11px] text-text-muted uppercase tracking-[1px] mb-1">Last Scan</div>
           <div className="font-mono text-[14px] text-text-base">
             {shipment.events[0]?.facility || shipment.events[0]?.location || 'Pending Initialization'}
           </div>
        </div>
      </div>
    </div>
  )
}