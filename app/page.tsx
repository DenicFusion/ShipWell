import { TrackingHero } from "@/components/tracking/TrackingHero"
import { ShipwellLogo } from "@/components/ShipwellLogo"
import { ThemeSwitch } from "@/components/ThemeSwitch"
import Link from "next/link"
import { Calendar, PackageOpen, Building2 } from "lucide-react"

import Image from "next/image"

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-base transition-colors duration-300">
      <header className="absolute top-0 z-50 w-full border-b border-border-line/50 bg-bg-base/80 backdrop-blur-md">
        <div className="mx-auto flex h-[80px] max-w-[1024px] items-center px-6 md:px-10 justify-between">
          <Link href="/">
             <ShipwellLogo />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm font-semibold text-text-muted hover:text-text-base transition-colors mr-2">Admin</Link>
            <ThemeSwitch />
          </div>
        </div>
      </header>
      
      <TrackingHero />
      
      <section className="w-full relative z-20 -mt-10 mx-auto max-w-[1024px] px-6 md:px-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-[16px] bg-bg-card border border-border-line p-8 flex flex-col items-center text-center shadow-lg hover:-translate-y-1 transition-transform cursor-pointer">
            <Calendar className="w-12 h-12 text-brand-primary mb-4" />
            <h3 className="font-bold text-xl text-text-base mb-2">Ship Now</h3>
            <p className="text-text-muted text-sm">Find the right service</p>
          </div>
          <div className="rounded-[16px] bg-bg-card border border-border-line p-8 flex flex-col items-center text-center shadow-lg hover:-translate-y-1 transition-transform cursor-pointer">
            <PackageOpen className="w-12 h-12 text-brand-primary mb-4" />
            <h3 className="font-bold text-xl text-text-base mb-2">Get a Quote</h3>
            <p className="text-text-muted text-sm">Estimate cost to share and compare</p>
          </div>
          <div className="rounded-[16px] border-t-4 border-t-brand-primary bg-bg-card border border-border-line p-8 flex flex-col items-center text-center shadow-lg hover:-translate-y-1 transition-transform cursor-pointer">
            <Building2 className="w-12 h-12 text-brand-primary mb-4" />
            <h3 className="font-bold text-xl text-text-base mb-2">Shipwell for Business</h3>
            <p className="text-text-muted text-sm">Shipping regularly? Request a business account and profit from exclusive benefits</p>
          </div>
        </div>
      </section>

      <section className="w-full bg-bg-base py-20 px-6 md:px-10">
        <div className="mx-auto max-w-[1024px] rounded-[24px] bg-brand-primary overflow-hidden shadow-2xl relative">
          <div className="absolute inset-0 bg-black/10 mix-blend-multiply" />
          <div className="relative z-10 p-10 md:p-16 flex flex-col md:flex-row items-center gap-10">
             <div className="flex-1 text-white">
                <h2 className="text-3xl md:text-5xl font-display font-bold mb-4 uppercase tracking-wide text-white">
                  Stop Tracking the Box. Start Tracking Your Future.
                </h2>
                <p className="text-white/80 text-lg mb-6">
                  Your career deserves a fast route, too. Explore open roles with stability and clear paths for advancement. Don&apos;t wait for your next step - build it!
                </p>
                <div className="bg-bg-surface text-brand-primary inline-flex px-8 py-3 rounded-full font-bold uppercase tracking-wider hover:bg-white cursor-pointer transition-colors shadow">
                  Unbox Your Potential
                </div>
             </div>
             <div className="w-full md:w-1/3 relative h-[300px]">
                <Image unoptimized src="https://images.unsplash.com/photo-1542744173-8e7e53415bb0?q=80&w=600&auto=format&fit=crop" alt="Logistics Professional" fill className="rounded-[16px] shadow-lg object-cover" referrerPolicy="no-referrer" />
             </div>
          </div>
        </div>
      </section>

      <section className="w-full border-t border-border-line bg-bg-surface py-16">
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

      <footer className="w-full border-t border-border-line bg-bg-base py-16">
        <div className="mx-auto max-w-[1024px] px-6 md:px-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1">
               <ShipwellLogo className="mb-6 opacity-70" />
               <p className="text-text-muted text-sm">The world&apos;s leading logistics network. Connecting people, improving lives.</p>
            </div>
            <div>
              <h4 className="font-bold text-text-base mb-4 uppercase tracking-wider text-sm">Quick Links</h4>
              <ul className="space-y-3 text-text-muted text-sm">
                <li><Link href="/" className="hover:text-brand-primary">Customer Service</Link></li>
                <li><Link href="/" className="hover:text-brand-primary">Customer Portal Logins</Link></li>
                <li><Link href="/" className="hover:text-brand-primary">Get a Quote</Link></li>
                <li><Link href="/" className="hover:text-brand-primary">Shipwell for Business</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-text-base mb-4 uppercase tracking-wider text-sm">Legal</h4>
              <ul className="space-y-3 text-text-muted text-sm">
                <li><Link href="/" className="hover:text-brand-primary">Terms of Use</Link></li>
                <li><Link href="/" className="hover:text-brand-primary">Privacy Notice</Link></li>
                <li><Link href="/" className="hover:text-brand-primary">Fraud Awareness</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-border-line/50 text-center text-text-muted text-sm">
            2026 © - all rights reserved
          </div>
        </div>
      </footer>
    </main>
  )
}