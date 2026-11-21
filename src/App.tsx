import React, { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { ShipWellProvider } from "@/components/providers/ShipWellProvider";
import HomePage from "@/src/pages/HomePage";
import QuotePage from "@/src/pages/QuotePage";
import ShipPage from "@/src/pages/ShipPage";
import BusinessShippingPage from "@/src/pages/BusinessShippingPage";
import TrackPage from "@/src/pages/TrackPage";
import DashboardPage from "@/src/pages/DashboardPage";
import LoginPage from "@/src/pages/LoginPage";
import SignupPage from "@/src/pages/SignupPage";
import ForgotPasswordPage from "@/src/pages/ForgotPasswordPage";
import LegalPage from "@/src/pages/LegalPage";
import AdminLoginPage from "@/src/pages/admin/AdminLoginPage";
import AdminOverviewPage from "@/src/pages/admin/AdminOverviewPage";
import AdminShipmentsPage from "@/src/pages/admin/AdminShipmentsPage";
import AdminShipmentDetailPage from "@/src/pages/admin/AdminShipmentDetailPage";
import AdminAlertsPage from "@/src/pages/admin/AdminAlertsPage";
import AdminCustomersPage from "@/src/pages/admin/AdminCustomersPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60 * 1000 } },
});

function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      const timer = window.setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
        }
      }, 60);
      return () => window.clearTimeout(timer);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    return undefined;
  }, [pathname, hash]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ShipWellProvider>
          <ScrollManager />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/quote" element={<QuotePage />} />
            <Route path="/ship" element={<ShipPage />} />
            <Route path="/business-shipping" element={<BusinessShippingPage />} />
            <Route path="/track" element={<TrackPage />} />
            <Route path="/track/:trackingId" element={<TrackPage />} />
            <Route path="/dashboard" element={<DashboardPage section="overview" />} />
            <Route path="/dashboard/incoming" element={<DashboardPage section="incoming" />} />
            <Route path="/dashboard/sent" element={<DashboardPage section="sent" />} />
            <Route path="/dashboard/track" element={<DashboardPage section="track" />} />
            <Route path="/dashboard/track/:code" element={<DashboardPage section="track" />} />
            <Route path="/dashboard/alerts" element={<DashboardPage section="alerts" />} />
            <Route path="/dashboard/account" element={<DashboardPage section="account" />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/auth/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/shipments" element={<AdminShipmentsPage />} />
            <Route path="/admin/shipment/:code" element={<AdminShipmentDetailPage />} />
            <Route path="/admin/alerts" element={<AdminAlertsPage />} />
            <Route path="/admin/customers" element={<AdminCustomersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
        </ShipWellProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
