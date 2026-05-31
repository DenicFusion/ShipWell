import { DM_Sans, Syne, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "700"], variable: "--font-dm-sans" });
const syne = Syne({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-syne" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-jetbrains-mono" });

export const metadata = {
  title: "Shipwell Tracker",
  description: "Track your shipment real-time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${syne.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning className="bg-bg-base text-text-base font-sans antialiased transition-colors duration-300">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}