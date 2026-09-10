import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

interface ManagerSummaryItem {
  label: string;
  description: string;
  action: string;
  href: string;
  count: number;
}

/** Yönetici ve üst yöneticinin ana ekrandaki kısa iş özeti. */
export function ManagerSummaryBlock({
  pendingAbsence,
  newFeedback,
}: {
  pendingAbsence: number | null;
  newFeedback: number | null;
}) {
  const items: ManagerSummaryItem[] = [];

  if (pendingAbsence !== null) {
    items.push({
      label: "Onay bekleyen izin",
      description:
        pendingAbsence > 0
          ? "Kararınızı bekleyen izin talepleri var."
          : "Kararınızı bekleyen izin talebi yok.",
      action: "İzinleri aç",
      href: "/team/absence?durum=bekliyor",
      count: pendingAbsence,
    });
  }

  if (newFeedback !== null) {
    items.push({
      label: "Yeni geri bildirim",
      description:
        newFeedback > 0
          ? "Okuyup durumunu güncellemeniz gereken kayıtlar var."
          : "Yeni geri bildirim bulunmuyor.",
      action: "Geri bildirimleri aç",
      href: "/feedback?sekme=yonetim",
      count: newFeedback,
    });
  }

  if (items.length === 0) return null;

  return (
    <Card id="yonetici-isleri" data-test="yonetici-isleri">
      <CardHeader
        title="Yönetici işleri"
        description="Doğrudan ilgilenmeniz gereken izin ve geri bildirimler."
      />
      <CardBody className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex min-h-28 flex-col justify-between gap-4 rounded-(--radius-sm) border border-line bg-inset/30 px-3.5 py-3 transition-colors duration-(--duration-fast) hover:border-primary-line hover:bg-surface-hover"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-[length:var(--text-sm)] font-semibold text-ink">
                {item.label}
              </span>
              <Badge tone={item.count > 0 ? "waiting" : "neutral"}>
                {item.count}
              </Badge>
            </span>
            <span className="flex items-end justify-between gap-3">
              <span className="min-w-0 text-[length:var(--text-xs)] leading-[var(--leading-normal)] text-muted">
                {item.description}
              </span>
              <span className="shrink-0 text-[length:var(--text-xs)] font-medium text-primary group-hover:underline">
                {item.action} →
              </span>
            </span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
