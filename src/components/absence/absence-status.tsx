import type {
  NoActivityDecisionRoute,
  NoActivityPeriodStatus,
} from "@prisma/client";

import { Badge, type BadgeTone } from "@/components/ui/badge";

export function absenceStatusLabel(status: NoActivityPeriodStatus): string {
  switch (status) {
    case "PENDING":
      return "Onay bekliyor";
    case "APPROVED":
      return "Onaylandı";
    case "REJECTED":
      return "Reddedildi";
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
  return (
    <Badge tone={absenceStatusTone(status)}>
      {absenceStatusLabel(status)}
    </Badge>
  );
}

export function absenceDecisionRouteLabel(
  route: NoActivityDecisionRoute | null,
): string | null {
  switch (route) {
    case "DIRECT_ENTRY":
      return "Doğrudan giriş";
    case "DIRECT_MANAGER":
      return "Departman yöneticisi";
    case "DEPUTY":
      return "Vekil yönetici";
    case "UPPER_MANAGER":
      return "Üst yönetici";
    default:
      return null;
  }
}
