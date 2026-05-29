const fs = require('fs');
const path = require('path');

const files = {
  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
  'next.config.mjs': `/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;`,
  'postcss.config.mjs': `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;`,
  'types/tracking.ts': `export enum ShipmentStatus {
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  EXCEPTION = "EXCEPTION",
  OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY",
  RETURNED = "RETURNED"
}
export interface TrackingEventData {
  id: string;
  isLogical: boolean;
  isLatest: boolean;
  statusColor: string;
  eventCode: string;
  label: string;
  description: string;
  facility?: string;
  location?: string;
  formattedDate: string;
  formattedTime: string;
}
export interface ShipmentData {
  status: ShipmentStatus;
  carrier: string;
  trackingNumber: string;
  estimatedDelivery?: string;
  origin: { city: string; state: string; zip: string };
  destination: { city: string; state: string; zip: string };
  events: TrackingEventData[];
}`,
  'app/globals.css': `@import "tailwindcss";
@import "tw-animate-css";

@theme {
  --color-bg-base: var(--bg-base);
  --color-bg-surface: var(--bg-surface);
  --color-bg-card: var(--bg-card);
  --color-text-base: var(--text-base);
  --color-text-muted: var(--text-muted);
  --color-border-line: var(--border-line);
  
  --color-brand-primary: var(--brand-primary);
  --color-brand-primary-hover: var(--brand-primary-hover);
  --color-brand-secondary: var(--brand-secondary);

  --color-brand-success: #10B981;
  --color-brand-warning: #F59E0B;
  --color-brand-danger: #EF4444;

  --font-sans: var(--font-dm-sans);
  --font-mono: var(--font-geist-mono);
}

:root {
  /* Light Theme */
  --bg-base: #ECFDF5;
  --bg-surface: #ffffff;
  --bg-card: #ffffff;
  --text-base: #052E16;
  --text-muted: #059669;
  --border-line: rgba(5, 150, 105, 0.2);
  
  --brand-primary: #059669;
  --brand-primary-hover: #047857;
  --brand-secondary: #052E16;
  
  /* Logo Colors */
  --logo-bg: #059669;
  --logo-box: #ECFDF5;
  --logo-stripe: #A7F3D0;
  --logo-path1: #6EE7B7;
  --logo-path2: #D1FAE5;
  --logo-path3: #ECFDF5;
  --logo-accent: #059669;
}

.dark {
  /* Dark Theme */
  --bg-base: #020E06;
  --bg-surface: #052E16;
  --bg-card: rgba(255, 255, 255, 0.02);
  --text-base: #ECFDF5;
  --text-muted: #34D399;
  --border-line: rgba(52, 211, 153, 0.2);
  
  --brand-primary: #10B981;
  --brand-primary-hover: #34D399;
  --brand-secondary: #059669;
  
  /* Logo Colors */
  --logo-bg: #052E16;
  --logo-box: #10B981;
  --logo-stripe: #059669;
  --logo-path1: #34D399;
  --logo-path2: #34D399;
  --logo-path3: #10B981;
  --logo-accent: #ECFDF5;
}

body {
  background-color: var(--bg-base);
  color: var(--text-base);
  font-family: var(--font-sans), sans-serif;
  min-height: 100vh;
}

.hero-pattern {
  background-image: linear-gradient(var(--border-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-line) 1px, transparent 1px);
  background-size: 40px 40px;
}`,
  'app/layout.tsx': `import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-dm-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata = {
  title: "Shipwell Tracker",
  description: "Track your shipment real-time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={\`\${inter.variable} \${jetbrainsMono.variable}\`}>
      <body suppressHydrationWarning className="bg-bg-base text-text-base font-sans antialiased transition-colors duration-300">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}`,
  'app/providers.tsx': `'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ThemeProvider } from 'next-themes';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}`,
  'lib/utils.ts': `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}`,
  'components/ShipwellLogo.tsx': `import React from 'react';

export function ShipwellLogo({ className = "" }: { className?: string }) {
  return (
    <div className={\`flex items-center gap-3 \${className}\`}>
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
}`,
  'components/ThemeSwitch.tsx': `'use client';
import { useTheme } from 'next-themes'
import { Search, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ThemeSwitch() {
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="w-9 h-9" />
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-md hover:bg-bg-surface text-text-muted hover:text-text-base transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  )
}`,
  'components/ui/Button.tsx': `import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand-primary text-white shadow hover:bg-brand-primary-hover",
        destructive: "bg-brand-danger text-white shadow-sm hover:bg-brand-danger/90",
        outline: "border border-border-line bg-transparent shadow-sm hover:bg-bg-surface hover:text-text-base text-text-muted",
        secondary: "bg-bg-surface text-text-base shadow-sm hover:bg-border-line/20",
        ghost: "hover:bg-bg-card hover:text-text-base text-text-muted",
        link: "text-brand-primary underline-offset-4 hover:underline",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", lg: "h-12 rounded-[8px] px-[24px] text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = "Button"
export { Button, buttonVariants }`,
  'components/ui/SearchBar.tsx': `'use client';
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "./Button"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"

export function SearchBar({ className }: { className?: string }) {
  const [value, setValue] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    router.push("/track/" + value)
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
    </div>
  )
}`,
  'components/tracking/TrackingHero.tsx': `import { SearchBar } from "../ui/SearchBar"

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
}`,
  'app/page.tsx': `import { TrackingHero } from "@/components/tracking/TrackingHero"
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
}`,
  'app/track/layout.tsx': `import { SearchBar } from "@/components/ui/SearchBar"
import { ShipwellLogo } from "@/components/ShipwellLogo"
import { ThemeSwitch } from "@/components/ThemeSwitch"
import Link from "next/link"

export default function TrackingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg-base flex flex-col transition-colors duration-300">
      <header className="sticky top-0 z-50 w-full border-b border-border-line bg-bg-base/80 backdrop-blur-md transition-colors duration-300">
        <div className="mx-auto flex h-[80px] max-w-[1024px] items-center px-6 md:px-10 justify-between">
          <Link href="/">
             <ShipwellLogo />
          </Link>
          <div className="flex-1 max-w-md hidden sm:block mx-8">
            <div className="scale-90 origin-right">
               <SearchBar />
            </div>
          </div>
          <ThemeSwitch />
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}`,
  'app/track/[trackingId]/page.tsx': `'use client';
import { ShipmentSummaryCard } from "@/components/tracking/ShipmentSummaryCard"
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline"
import { ShipmentData, ShipmentStatus } from "@/types/tracking"
import { useParams } from "next/navigation"

const MOCK_DATA: ShipmentData = {
  status: ShipmentStatus.IN_TRANSIT,
  carrier: "USPS",
  trackingNumber: "SW9483021948",
  estimatedDelivery: new Date(Date.now() + 86400000 * 2).toISOString(),
  origin: { city: "Los Angeles", state: "CA", zip: "90001" },
  destination: { city: "New York", state: "NY", zip: "10001" },
  events: [
    {
      id: "1",
      isLatest: true,
      isLogical: false,
      statusColor: "bg-brand-primary",
      eventCode: "IN_TRANSIT",
      label: "In Transit to Next Facility",
      description: "Package is moving within the USPS network.",
      facility: "Sortation Center",
      location: "Denver, CO",
      formattedDate: "Today",
      formattedTime: "08:42 AM"
    },
    {
      id: "2",
      isLatest: false,
      isLogical: false,
      statusColor: "bg-brand-primary",
      eventCode: "ARRIVED",
      label: "Arrived at Facility",
      description: "Package arrived at regional hub.",
      facility: "Regional Facility",
      location: "Los Angeles, CA",
      formattedDate: "Yesterday",
      formattedTime: "11:30 PM"
    },
    {
      id: "3",
      isLatest: false,
      isLogical: false,
      statusColor: "bg-brand-primary",
      eventCode: "PICKUP",
      label: "Shipment Picked Up",
      description: "Carrier has received the package from the sender.",
      location: "Sender Location",
      formattedDate: "Yesterday",
      formattedTime: "04:15 PM"
    }
  ]
}

export default function TrackingPage() {
  const params = useParams()
  const data = { ...MOCK_DATA, trackingNumber: ((params.trackingId as string) || "SW9483021948").toUpperCase() };

  return (
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
  )
}`,
  'components/tracking/ShipmentSummaryCard.tsx': `import { ShipmentData, ShipmentStatus } from "@/types/tracking"
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
}`,
  'components/tracking/TrackingTimeline.tsx': `import { ShipmentData } from "@/types/tracking"
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
}`,
  'components/tracking/TimelineEvent.tsx': `import { motion } from "motion/react"
import { TrackingEventData } from "@/types/tracking"
import { cn } from "@/lib/utils"

export function TimelineEvent({ event }: { event: TrackingEventData }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
      }}
      className={\`relative flex justify-between items-start \${event.isLogical ? 'opacity-80' : ''}\`}
    >
      <div className={cn(
         "absolute -left-[50px] w-[18px] h-[18px] rounded-full border-[3px] border-brand-primary top-[4px] box-border bg-bg-base",
         event.isLatest ? "shadow-[0_0_15px_var(--brand-primary)]" : "border-opacity-50"
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
}`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}
console.log('Restored files successfully.');
