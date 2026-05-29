import { SearchBar } from "@/components/ui/SearchBar"
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
}
