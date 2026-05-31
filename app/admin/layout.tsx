"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ShipwellLogo } from "@/components/ShipwellLogo";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Check localStorage only — instant, no async, no Firestore
    const isAdmin = localStorage.getItem("sw_is_admin") === "true";
    if (!isAdmin && pathname !== "/admin/login") {
      router.replace("/admin/login");
    } else {
      setChecked(true);
    }
  }, [router, pathname]);

  if (!checked) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg-base flex-col text-text-base font-sans">
      {children}
    </div>
  );
}
