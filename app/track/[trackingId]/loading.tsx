'use client';

import { Skeleton } from "@/components/ui/Skeleton"
import { Package } from "lucide-react"

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
        
        {/* Skeleton Left Panel */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm sticky top-6">
            <div className="flex flex-col gap-6">
              
              {/* Header Skeleton */}
              <div className="flex items-start justify-between border-b border-white/10 pb-6">
                <div className="space-y-3">
                   <Skeleton className="h-5 w-16" />
                   <Skeleton className="h-8 w-48" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              
              {/* ETA Skeleton */}
              <div className="rounded-lg bg-black/20 p-4 border border-white/5 space-y-3">
                 <Skeleton className="h-4 w-32" />
                 <Skeleton className="h-6 w-40" />
                 <Skeleton className="h-4 w-20" />
              </div>

               {/* Route Skeleton */}
               <div className="space-y-6 pt-2 pl-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-20" />
                  </div>
               </div>

            </div>
          </div>
        </div>

        {/* Skeleton Right Panel */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-white/10 bg-black/20 p-6 md:p-8">
            <h2 className="font-display tracking-wide text-2xl text-white mb-8 border-b border-white/10 pb-4">
              Tracking History
            </h2>
            
            <div className="space-y-12 pl-4 relative">
               <div className="absolute left-[11px] top-6 h-full w-0.5 -translate-x-[1px] bg-white/10" />
               {[...Array(5)].map((_, i) => (
                  <div key={i} className="relative flex gap-6">
                    <div className="relative z-10 shrink-0 h-6 pt-1 bg-brand-navy">
                       <Skeleton className="h-3 w-3 rounded-full mt-1.5" />
                    </div>
                    <div className="flex-1 rounded-lg border border-white/5 p-4 space-y-3">
                       <div className="flex justify-between items-start">
                         <div className="space-y-2">
                            <Skeleton className="h-5 w-48" />
                            <Skeleton className="h-4 w-64" />
                            <Skeleton className="h-4 w-32 mt-2" />
                         </div>
                         <div className="space-y-2 items-end flex flex-col">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-16" />
                         </div>
                       </div>
                    </div>
                  </div>
               ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
