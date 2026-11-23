import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  DashboardShell,
  type DashboardSection,
} from "@/components/dashboard/DashboardShell";
import { useDashboardShipments } from "@/components/dashboard/useDashboardShipments";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { DashboardParcelList } from "@/components/dashboard/DashboardParcelList";
import { DashboardTrack } from "@/components/dashboard/DashboardTrack";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import { DashboardAccount } from "@/components/dashboard/DashboardAccount";
import { DashboardSupport } from "@/components/dashboard/DashboardSupport";
import { QuoteCalculator } from "@/components/quote/QuoteCalculator";
import { ShipWizard } from "@/components/ship/ShipWizard";
import { formatTrackingCode } from "@/types/tracking";

export default function DashboardPage({
  section = "overview",
}: {
  section?: DashboardSection;
}) {
  const { user, profile, isAdmin } = useShipWell();
  const params = useParams<{ code?: string; threadId?: string }>();
  const routeCode = params.code ? formatTrackingCode(params.code) : "";
  const routeThreadId = params.threadId || "";

  const {
    loading,
    incoming,
    sent,
    allUnique,
    receiverStatusMap,
    openAlerts,
    resolvedAlerts,
  } = useDashboardShipments({
    uid: user?.uid,
    email: user?.email,
    emailVerified: user?.emailVerified,
  });

  const displayName =
    profile?.name ||
    user?.displayName ||
    user?.email?.split("@")[0] ||
    "ShipWell Customer";

  const incomingActiveCount = useMemo(
    () => incoming.filter((s) => s.status !== "Delivered").length,
    [incoming]
  );

  const meta = useMemo(() => {
    if (section === "incoming") {
      return {
        title: "Incoming",
        subtitle: `Parcels addressed to ${user?.email || ""}`,
      };
    }
    if (section === "sent") {
      return {
        title: "Sent",
        subtitle: "Shipments you booked",
      };
    }
    if (section === "track") {
      return {
        title: "Track",
        subtitle: routeCode || "Live status and full history",
      };
    }
    if (section === "alerts") {
      return {
        title: "Actions",
        subtitle: openAlerts.length
          ? `${openAlerts.length} waiting for you`
          : "Nothing pending",
      };
    }
    if (section === "support") {
      return {
        title: "Support",
        subtitle: "Messages with ShipWell operations",
      };
    }
    if (section === "quote") {
      return {
        title: "Quote",
        subtitle: "Instant rate & transit estimate",
      };
    }
    if (section === "ship") {
      return {
        title: "Ship",
        subtitle: "Book a door-to-door pickup",
      };
    }
    if (section === "account") {
      return {
        title: "Account",
        subtitle: "Your details, notifications and appearance",
      };
    }
    return {
      title: "Home",
      subtitle: new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    };
  }, [section, user?.email, routeCode, openAlerts.length]);

  return (
    <DashboardShell
      section={section}
      title={meta.title}
      subtitle={meta.subtitle}
      incomingActiveCount={incomingActiveCount}
      sentCount={sent.length}
      openAlertsCount={openAlerts.length}
      loading={Boolean(
        user &&
          loading &&
          section !== "track" &&
          section !== "account" &&
          section !== "support" &&
          section !== "quote" &&
          section !== "ship"
      )}
    >
      {user && section === "overview" && (
        <DashboardOverview
          user={user}
          displayName={displayName}
          incoming={incoming}
          sent={sent}
          allUnique={allUnique}
          openAlerts={openAlerts}
        />
      )}

      {user && section === "incoming" && (
        <DashboardParcelList
          mode="incoming"
          list={incoming}
          userEmail={user.email || ""}
          receiverStatusMap={receiverStatusMap}
        />
      )}

      {user && section === "sent" && (
        <DashboardParcelList
          mode="sent"
          list={sent}
          userEmail={user.email || ""}
          receiverStatusMap={receiverStatusMap}
        />
      )}

      {user && section === "track" && (
        <DashboardTrack
          routeCode={routeCode}
          user={user}
          isAdmin={isAdmin}
          allUnique={allUnique}
          receiverStatusMap={receiverStatusMap}
        />
      )}

      {user && section === "alerts" && (
        <DashboardAlerts
          openAlerts={openAlerts}
          resolvedAlerts={resolvedAlerts}
        />
      )}

      {user && section === "support" && (
        <DashboardSupport
          user={user}
          displayName={displayName}
          allUnique={allUnique}
          routeThreadId={routeThreadId}
        />
      )}

      {user && section === "quote" && <QuoteCalculator embedded />}

      {user && section === "ship" && <ShipWizard embedded />}

      {user && section === "account" && (
        <DashboardAccount user={user} profile={profile} />
      )}
    </DashboardShell>
  );
}
