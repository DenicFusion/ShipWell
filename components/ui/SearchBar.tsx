'use client';

import * as React from "react"
import { Search, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./Button"
import { useTrackingStore } from "@/store/trackingStore"
import { useRouter } from "next/navigation"
import { TrackingNumberSchema } from "@/types/tracking"

export function SearchBar({ className }: { className?: string }) {
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState("")
  const [isFocused, setIsFocused] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const addSearch = useTrackingStore(state => state.addSearch)
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    
    const formattedVal = value.trim().toUpperCase()
    const result = TrackingNumberSchema.safeParse(formattedVal)
    
    if (!result.success) {
      setError("Tracking numbers must be 10–30 alphanumeric characters.")
      return
    }

    setIsLoading(true)
    addSearch(formattedVal)
    router.push(`/track/${formattedVal}`)
  }

  return (
    <div className={cn("w-full relative z-[2]", className)}>
      <form onSubmit={handleSubmit} className="relative z-10 flex w-full items-center">
        <div className={cn(
          "relative flex w-full items-center overflow-hidden rounded-[12px] border transition-all duration-300 shadow-[0_0_20px_rgba(16,185,129,0.1)] bg-bg-card backdrop-blur-md",
          isFocused ? "border-brand-primary shadow-[0_0_30px_-5px_rgba(16,185,129,0.2)]" : "border-brand-primary"
        )}>
          <input 
            type="text" 
            placeholder="Enter tracking number..."
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="w-full bg-transparent p-[18px_24px] pr-[130px] text-[18px] text-text-base placeholder:text-text-muted focus:outline-none font-mono"
          />
          <div className="absolute right-[8px] top-[8px] bottom-[8px]">
            <Button 
              type="submit" 
              className="h-full rounded-[8px] bg-brand-primary font-bold px-[24px] text-white border-none py-0 shadow-none hover:bg-brand-primary-hover transition-colors"
              disabled={isLoading || value.length < 5}
            >
              {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              LOCATE
            </Button>
          </div>
        </div>
      </form>
      {error && (
        <div className="absolute -bottom-8 left-0 w-full text-center text-sm text-brand-danger animate-in fade-in slide-in-from-top-2">
          {error}
        </div>
      )}
    </div>
  )
}
