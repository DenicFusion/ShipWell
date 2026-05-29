'use client';

import { SearchBar } from "@/components/ui/SearchBar"

export function TrackingHero() {
  return (
    <div className="relative flex h-[360px] w-full flex-col items-center justify-center overflow-hidden border-b border-border-line bg-gradient-to-b from-bg-surface to-bg-base mt-[80px]">
      <div className="absolute inset-0 bg-[linear-gradient(45deg,var(--border-line)_25%,transparent_25%,transparent_50%,var(--border-line)_50%,var(--border-line)_75%,transparent_75%,transparent)] bg-[length:30px_30px] opacity-30 pointer-events-none" />
      <div className="absolute z-[1] h-[400px] w-[400px] bg-[radial-gradient(circle,var(--border-line)_0%,transparent_70%)] opacity-50" />
      
      <div className="relative z-10 w-full max-w-4xl space-y-6 flex flex-col items-center mt-6">
        <h1 className="font-display text-5xl sm:text-6xl md:text-[72px] uppercase tracking-[2px] text-text-base z-10 m-0 text-center">
          PRECISION TRACKING
        </h1>

        <div className="w-full max-w-[600px] z-[2]">
          <SearchBar />
        </div>
      </div>
    </div>
  )
}
