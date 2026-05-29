import { TrackingHero } from "@/components/tracking/TrackingHero"
import { ShipwellLogo } from "@/components/ShipwellLogo"
import { ThemeSwitch } from "@/components/ThemeSwitch"
import Link from "next/link"

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-base transition-colors duration-300">
      <header className="absolute top-0 z-50 w-full border-b border-border-line/50 bg-bg-base/80 backdrop-blur-md">
        <div className="mx-auto flex h-[80px] max-w-[1024px] items-center px-6 md:px-10 justify-between">
          <Link href="/">
             <ShipwellLogo />
          </Link>
          <ThemeSwitch />
        </div>
      </header>
      
      <TrackingHero />
      
      {/* Stats Section */}
      <section className="w-full border-t border-border-line bg-bg-surface py-16 flex-1">
        <div className="mx-auto max-w-[1024px] px-6 md:px-10">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border-line">
            <div className="flex flex-col items-center text-center space-y-2 py-4">
              <div className="font-display text-5xl sm:text-6xl text-brand-primary">99.98%</div>
              <div className="text-[12px] uppercase tracking-widest text-text-muted font-bold">On-Time Delivery</div>
            </div>
            <div className="flex flex-col items-center text-center space-y-2 py-4">
              <div className="font-display text-5xl sm:text-6xl text-brand-primary">200M+</div>
              <div className="text-[12px] uppercase tracking-widest text-text-muted font-bold">Packages Tracked</div>
            </div>
            <div className="flex flex-col items-center text-center space-y-2 py-4">
              <div className="font-display text-5xl sm:text-6xl text-brand-success">LIVE</div>
              <div className="text-[12px] uppercase tracking-widest text-text-muted font-bold">Real-Time Updates</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}