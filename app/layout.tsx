import { Bebas_Neue, Outfit, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { Toaster } from "react-hot-toast";

const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-outfit",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "ShipWell — The World's Goods. Delivered With Precision.",
  description:
    "Global luxury logistics platform with live tracking, instant quotes, dual sender/receiver dashboards, and automated parcel alerts.",
  openGraph: {
    title: "ShipWell — The World's Goods. Delivered With Precision.",
    description:
      "Global luxury logistics platform with live tracking, instant quotes, dual sender/receiver dashboards, and automated parcel alerts.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${bebasNeue.variable} ${outfit.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        suppressHydrationWarning
        className="bg-bg-base text-text-base font-sans antialiased"
      >
        <Providers>
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              style: {
                background: "#111827",
                color: "#F1F5F9",
                border: "1px solid #1E293B",
                borderRadius: "12px",
                fontSize: "13.5px",
                fontWeight: 500,
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}