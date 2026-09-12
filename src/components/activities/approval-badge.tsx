"use client";

import { useTranslations } from "@/components/i18n";
import { Badge, type BadgeTone } from "@/components/ui/badge";


//




//



const STATUS: Record<string, { labelKey: string; tone: BadgeTone }> = {
  APPROVED: { labelKey: "activityStatus.APPROVED", tone: "success" },
  PENDING_APPROVAL: { labelKey: "activityStatus.PENDING_APPROVAL", tone: "waiting" },
  CHANGES_REQUESTED: { labelKey: "activityStatus.CHANGES_REQUESTED", tone: "correction" },
  MANAGER_NOT_FOUND: { labelKey: "activityStatus.MANAGER_NOT_FOUND", tone: "danger" },
  REJECTED: { labelKey: "activityStatus.REJECTED", tone: "danger" },
  CANCELLED: { labelKey: "activityStatus.CANCELLED", tone: "cancelled" },
  DRAFT: { labelKey: "activityStatus.DRAFT", tone: "neutral" },
};

export function statusText(status: string): string {
  return STATUS[status]?.labelKey ?? status;
}

export function ApprovalBadge({ status }: { status: string }) {
  const t = useTranslations();
  const config = STATUS[status] ?? { labelKey: status, tone: "neutral" as BadgeTone };
  return <Badge tone={config.tone}>{t(config.labelKey)}</Badge>;
}
