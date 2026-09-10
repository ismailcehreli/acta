import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import type {
  WatchedItem,
  WorkItem,
  WorkKind,
} from "@/server/dashboard/work-queue";

// Tek iş kuyruğu (Görev 10.5).
//
// Eskiden "cevap bekleyen sorular" ve "onayımı bekleyenler" iki ayrı kutuydu.
// Kullanıcı açısından ikisi de aynı sorunun cevabı: **şimdi ne yapmalıyım?**
//
// "Cevap beklediklerim" bu listeden **ayrıldı**: yapılacak iş değil, izlenen
// iş. Aynı listede durduğu sürece kuyruk bitirilebilir görünmüyordu.

const TUR: Record<WorkKind, { etiket: string; tone: BadgeTone }> = {
  answer: { etiket: "Cevapla", tone: "waiting" },
  approve: { etiket: "Onayla", tone: "primary" },
  revise: { etiket: "Düzelt", tone: "correction" },
};

const KIMDEN: Record<WorkKind, (ad: string) => string> = {
  answer: (ad) => `${ad} sordu`,
  approve: (ad) => `${ad} gönderdi`,
  revise: (ad) => `${ad} düzeltme istedi`,
};

/** "3 iş günüdür bekliyor" — sıfırsa hiç yazılmaz; "0 gün" bilgi değildir. */
function beklemeMetni(isGunu: number): string | null {
  if (isGunu <= 0) return null;
  return `${isGunu} iş günüdür bekliyor`;
}

function Satir({ item }: { item: WorkItem }) {
  const tur = TUR[item.kind];
  const bekleme = beklemeMetni(item.waitingBusinessDays);

  return (
    <li data-test="is-satiri" data-tur={item.kind}>
      <Link
        href={`/activities/${item.activityId}`}
        className="flex items-start gap-3 rounded-(--radius-sm) px-2 py-2.5 transition-colors hover:bg-inset"
      >
        <span className="shrink-0 pt-0.5">
          <Badge tone={tur.tone}>{tur.etiket}</Badge>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--text-sm)] font-medium text-ink">
            {item.activityTitle}
          </span>
          <span className="block text-[length:var(--text-xs)] text-muted">
            {KIMDEN[item.kind](item.fromName)}
            {bekleme ? (
              <>
                {" · "}
                <span className={item.waitingBusinessDays >= 3 ? "text-correction" : undefined}>
                  {bekleme}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function IzlenenSatir({ item }: { item: WatchedItem }) {
  const bekleme = beklemeMetni(item.waitingBusinessDays);

  return (
    <li data-test="izlenen-satiri">
      <Link
        href={`/activities/${item.activityId}`}
        className="flex items-baseline gap-2 rounded-(--radius-sm) px-2 py-1.5 transition-colors hover:bg-inset"
      >
        <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-muted">
          {item.activityTitle}
        </span>
        <span className="shrink-0 text-[length:var(--text-xs)] text-muted">
          {item.counterpartName} yanıtlayacak
          {bekleme ? ` · ${bekleme}` : ""}
        </span>
      </Link>
    </li>
  );
}

export function WorkQueueBlock({
  items,
  watched,
}: {
  items: WorkItem[];
  watched: WatchedItem[];
}) {
  return (
    <Card id="is-kuyrugu" data-test="bana-dusenler" className="scroll-mt-6">
      <CardHeader
        title="Bana düşenler"
        description={
          items.length === 0
            ? undefined
            : "En uzun bekleyen en üstte. Tamamı sizin işiniz."
        }
        action={
          items.length > 0 ? (
            <span className="flex items-center gap-2">
              {/* Onay işi varken toplu ekrana kısa yol: müdür on kayıt için
                  on kez git-gel yapmasın (Görev 10.6). */}
              {items.some((item) => item.kind === "approve") ? (
                <Link
                  href="/approvals"
                  className="text-[length:var(--text-sm)] font-medium text-primary hover:underline"
                >
                  Toplu onayla
                </Link>
              ) : null}
              <Badge tone="waiting">{items.length} iş</Badge>
            </span>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="Size düşen bir iş yok."
          description="Size soru sorulduğunda, onayınız beklendiğinde ya da düzeltme istendiğinde burada görünür."
        />
      ) : (
        <CardBody className="py-2">
          <ul className="flex flex-col">
            {items.map((item) => (
              <Satir key={`${item.kind}:${item.activityId}`} item={item} />
            ))}
          </ul>
        </CardBody>
      )}

      {watched.length > 0 ? (
        <CardBody className="border-t border-line pt-3 pb-2">
          <p className="px-2 pb-1 text-[length:var(--text-xs)] font-medium text-muted uppercase tracking-[var(--tracking-wide)]">
            İzlediklerim
          </p>
          <ul className="flex flex-col" data-test="izlenenler">
            {watched.map((item) => (
              <IzlenenSatir key={item.activityId} item={item} />
            ))}
          </ul>
        </CardBody>
      ) : null}
    </Card>
  );
}
