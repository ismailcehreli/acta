import Link from "next/link";

import type { DeputyDecision } from "@/server/absence/deputy-read";
import { EmptyState } from "@/components/ui/card";
import { RecordItem, RecordList } from "@/components/ui/table";
import { formatInstantShort } from "@/shared/format/date-time";

// Vekâletle verilen kararların listesi.
//
// Her satır "ne oldu"yu tek cümlede söyler ve **kimin adına** verildiğini
// yazar. Vekâletin denetlenebilir olması buna bağlı: karar üç ay sonra
// tartışıldığında, kimin hangi sıfatla karar verdiği kayıtta durmalı.

const ISLEM_ADLARI: Record<string, string> = {
  activity_approved: "Onayladı",
  activity_changes_requested: "Düzeltme istedi",
  activity_rejected: "Uygun bulmadı",
};

export function KararListesi({ kararlar }: { kararlar: DeputyDecision[] }) {
  if (kararlar.length === 0) {
    return (
      <EmptyState
        title="Karar yok"
        description="Bu dönemde henüz bir onay, düzeltme ya da ret kararı vermediniz."
      />
    );
  }

  return (
    <RecordList>
      {kararlar.map((karar) => (
        <RecordItem
          key={`${karar.activityId}-${karar.at.toISOString()}`}
          data-test="vekalet-karari"
          className="sm:px-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                #{karar.activityNo}
              </span>
              <Link
                href={`/activities/${karar.activityId}`}
                className="font-medium text-ink hover:underline"
              >
                {karar.activityTitle}
              </Link>
            </p>
            <time className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
              {formatInstantShort(karar.at)}
            </time>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-sm)] text-muted">
            <span className="font-medium text-ink">
              {ISLEM_ADLARI[karar.action] ?? karar.action}
            </span>
            <span aria-hidden className="text-line-strong">·</span>
            <span>{karar.authorName} yazdı</span>
            {karar.onBehalfOfName ? (
              <>
                <span aria-hidden className="text-line-strong">·</span>
                {/* Vekâletin izi: kimin sıfatıyla karar verildiği. */}
                <span className="text-faint">
                  {karar.actorName}, {karar.onBehalfOfName} adına
                </span>
              </>
            ) : null}
          </p>
        </RecordItem>
      ))}
    </RecordList>
  );
}
