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
import {
  getAdminOrigin,
  isAdminHostname,
  isWebmailHostname,
  isPreviewHostname,
} from "@/lib/host";
import HomePage from "@/src/pages/HomePage";
import QuotePage from "@/src/pages/QuotePage";
import ShipPage from "@/src/pages/ShipPage";
import BusinessShippingPage from "@/src/pages/BusinessShippingPage";
import TrackPage from "@/src/pages/TrackPage";
import DashboardPage from "@/src/pages/DashboardPage";
import LoginPage from "@/src/pages/LoginPage";
import SignupPage from "@/src/pages/SignupPage";
import ForgotPasswordPage from "@/src/pages/ForgotPasswordPage";
import AuthActionPage from "@/src/pages/AuthActionPage";
import LegalPage from "@/src/pages/LegalPage";
import NotFoundPage from "@/src/pages/NotFoundPage";
import AdminLoginPage from "@/src/pages/admin/AdminLoginPage";
import AdminOverviewPage from "@/src/pages/admin/AdminOverviewPage";
import AdminShipmentsPage from "@/src/pages/admin/AdminShipmentsPage";
import AdminShipmentDetailPage from "@/src/pages/admin/AdminShipmentDetailPage";
import AdminPaymentsPage from "@/src/pages/admin/AdminPaymentsPage";
import AdminAlertsPage from "@/src/pages/admin/AdminAlertsPage";
import AdminCustomersPage from "@/src/pages/admin/AdminCustomersPage";
import AdminMessagesPage from "@/src/pages/admin/AdminMessagesPage";
import AdminMailPage from "@/src/pages/admin/AdminMailPage";
import WebmailPage from "@/src/pages/WebmailPage";
import AdminSettingsPage from "@/src/pages/admin/AdminSettingsPage";

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

function RobotsMetaManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onAdminHost = isAdminHostname();
    const shouldNoIndex =
      onAdminHost ||
      isWebmailHostname() ||
      pathname.startsWith("/webmail") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/auth/action");

    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (shouldNoIndex) {
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "robots";
        document.head.appendChild(meta);
      }
      meta.content = "noindex, nofollow";
    } else if (meta) {
      meta.content = "index, follow";
    }
  }, [pathname]);

  return null;
}

function AdminExternalRedirect() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const stripped = pathname.replace(/^\/admin/, "") || "/";
    const target = `${getAdminOrigin()}${stripped}${search}`;
    window.location.replace(target);
  }, [pathname, search]);

  return null;
}

export default function App() {
  const onAdminHost = isAdminHostname();
  const onWebmailHost = isWebmailHostname();
  const onPreviewHost = isPreviewHostname();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ShipWellProvider>
          <ScrollManager />
          <RobotsMetaManager />

          {onWebmailHost ? (
            <Routes>
              <Route path="*" element={<WebmailPage />} />
            </Routes>
          ) : onAdminHost ? (
            <Routes>
              <Route path="/login" element={<AdminLoginPage />} />
              <Route path="/" element={<AdminOverviewPage />} />
              <Route path="/shipments" element={<AdminShipmentsPage />} />
              <Route path="/shipment/:code" element={<AdminShipmentDetailPage />} />
              <Route path="/payments" element={<AdminPaymentsPage />} />
              <Route path="/alerts" element={<AdminAlertsPage />} />
              <Route path="/messages" element={<AdminMessagesPage />} />
              <Route path="/thread/:id" element={<AdminMessagesPage />} />
              <Route path="/mail" element={<AdminMailPage />} />
              <Route path="/customers" element={<AdminCustomersPage />} />
              <Route path="/settings" element={<AdminSettingsPage />} />
              <Route path="/admin" element={<Navigate to="/" replace />} />
              <Route path="/admin/login" element={<Navigate to="/login" replace />} />
              <Route path="/admin/shipments" element={<Navigate to="/shipments" replace />} />
              <Route path="/admin/payments" element={<Navigate to="/payments" replace />} />
              <Route path="/admin/alerts" element={<Navigate to="/alerts" replace />} />
              <Route path="/admin/messages" element={<Navigate to="/messages" replace />} />
              <Route path="/admin/mail" element={<Navigate to="/mail" replace />} />
              <Route path="/admin/customers" element={<Navigate to="/customers" replace />} />
              <Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
              <Route path="*" element={<NotFoundPage adminMode />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/quote" element={<QuotePage />} />
              <Route path="/ship" element={<ShipPage />} />
              <Route path="/business-shipping" element={<BusinessShippingPage />} />
              <Route path="/webmail" element={<WebmailPage />} />
              <Route path="/track" element={<TrackPage />} />
              <Route path="/track/:trackingId" element={<TrackPage />} />
              <Route path="/dashboard" element={<DashboardPage section="overview" />} />
              <Route path="/dashboard/incoming" element={<DashboardPage section="incoming" />} />
              <Route path="/dashboard/sent" element={<DashboardPage section="sent" />} />
              <Route path="/dashboard/track" element={<DashboardPage section="track" />} />
              <Route path="/dashboard/track/:code" element={<DashboardPage section="track" />} />
              <Route path="/dashboard/alerts" element={<DashboardPage section="alerts" />} />
              <Route path="/dashboard/support" element={<DashboardPage section="support" />} />
              <Route path="/dashboard/support/new" element={<DashboardPage section="support" />} />
              <Route path="/dashboard/support/:threadId" element={<DashboardPage section="support" />} />
              <Route path="/dashboard/quote" element={<DashboardPage section="quote" />} />
              <Route path="/dashboard/ship" element={<DashboardPage section="ship" />} />
              <Route path="/dashboard/account" element={<DashboardPage section="account" />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/auth/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/auth/action" element={<AuthActionPage />} />
              <Route path="/legal" element={<LegalPage />} />

              {onPreviewHost ? (
                <>
                  <Route path="/admin/login" element={<AdminLoginPage />} />
                  <Route path="/admin" element={<AdminOverviewPage />} />
                  <Route path="/admin/shipments" element={<AdminShipmentsPage />} />
                  <Route path="/admin/shipment/:code" element={<AdminShipmentDetailPage />} />
                  <Route path="/admin/payments" element={<AdminPaymentsPage />} />
                  <Route path="/admin/alerts" element={<AdminAlertsPage />} />
                  <Route path="/admin/messages" element={<AdminMessagesPage />} />
                  <Route path="/admin/thread/:id" element={<AdminMessagesPage />} />
                  <Route path="/admin/mail" element={<AdminMailPage />} />
                  <Route path="/admin/customers" element={<AdminCustomersPage />} />
                  <Route path="/admin/settings" element={<AdminSettingsPage />} />
                </>
              ) : (
                <>
                  <Route path="/admin" element={<AdminExternalRedirect />} />
                  <Route path="/admin/*" element={<AdminExternalRedirect />} />
                </>
              )}

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          )}

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
