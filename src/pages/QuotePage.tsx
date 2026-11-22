import React from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { QuoteCalculator } from "@/components/quote/QuoteCalculator";

export default function QuotePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main quote flex-1">
        <QuoteCalculator />
      </main>
      <Footer />
    </div>
  );
}
