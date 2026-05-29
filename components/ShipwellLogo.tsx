import React from 'react';

export function ShipwellLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg width="46" height="46" viewBox="0 0 46 46" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
        <rect width="46" height="46" rx="10" fill="var(--logo-bg)"/>
        <rect x="9" y="16" width="18" height="16" rx="2" fill="var(--logo-box)"/>
        <rect x="9" y="22" width="18" height="2.5" fill="var(--logo-stripe)"/>
        <path d="M9 18L18 14L27 18" stroke="var(--logo-path1)" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
        <path d="M30 20H40M30 23H37M30 26H39" stroke="var(--logo-path2)" strokeWidth="2" strokeLinecap="round" opacity="0.8"/>
        <path d="M37 17L41 23L37 29" stroke="var(--logo-path3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <div className="flex flex-col justify-center">
        <span className="font-sans font-bold text-xl leading-none text-text-base">Shipwell</span>
        <span className="font-sans text-[10px] uppercase tracking-widest text-[#059669] mt-1 font-semibold dark:text-[#34D399]">
          Track · Deliver · Repeat
        </span>
      </div>
    </div>
  )
}