"use client";

import type {
  NoActivityDecisionRoute,
  NoActivityPeriodStatus,
} from "@prisma/client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useTranslations } from "@/components/i18n";

export function absenceStatusLabel(status: NoActivityPeriodStatus): string {
  switch (status) {
    case "PENDING":
      return "Awaiting approval";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
  }
}

function absenceStatusTone(status: NoActivityPeriodStatus): BadgeTone {
  switch (status) {
    case "PENDING":
      return "waiting";
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "danger";
  }
}

export function AbsenceStatusBadge({
  status,
}: {
  status: NoActivityPeriodStatus;
}) {
  const t = useTranslations();
  const labelKey =
    status === "PENDING"
      ? "screens.absence.statusAwaitingApproval"
      : status === "APPROVED"
        ? "screens.absence.statusApproved"
        : "screens.absence.statusRejected";

  return (
    <Badge tone={absenceStatusTone(status)}>
      {t(labelKey)}
    </Badge>
  );
}

export function absenceDecisionRouteLabel(
  route: NoActivityDecisionRoute | null,
): string | null {
  switch (route) {
    case "DIRECT_ENTRY":
      return "Direct entry";
    case "DIRECT_MANAGER":
      return "Unit manager";
    case "DEPUTY":
      return "Deputy manager";
    case "UPPER_MANAGER":
      return "Supervisor";
    default:
      return null;
  }
}
