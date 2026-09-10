import type { ScoreTrend, UserScore } from "@/server/scoring/read";

// Skor gösterimi (Görev 11.11).
//
// **Tek sayı tarama için, kırılım karar için.** Genel puanın temel bölümünü
// ve takdir katkısını ayrı göstermek, puanın nasıl oluştuğunu anlaşılır kılar.

function yuzde(pay: number, payda: number): string {
  if (payda <= 0) return "—";
  return `%${Math.round((pay / payda) * 100)}`;
}

export function ScoreCard({
  score,
  appreciations,
  trend,
  self = true,
}: {
  score: UserScore;
  /** Eski çağıranlar için geri dönüş değeri; yeni skor alanı önceliklidir. */
  appreciations: number | null;
  /** Geçmiş dönemler ve düşüş işareti (Görev 11.11). */
  trend?: ScoreTrend;
  /** Kart kişinin kendi ekranında mı gösteriliyor? */
  self?: boolean;
}) {
  const appreciationCount = score.appreciationCount ?? appreciations ?? 0;
  const appreciationPoints = score.appreciationPoints ?? 0;
  const appreciationPointsPer = score.appreciationPointsPer ?? 0;
  const baseTotal = score.baseTotal ?? score.total - appreciationPoints;
  const raporlamaFiili = self ? "kayıt girdiniz" : "kayıt girdi";
  const kayitIyelik = self ? "kaydınızın" : "kaydın";
  const tamamlamaFiili = self ? "tamamladınız" : "tamamladı";
  const boyutlar = [
    {
      ad: "Düzenli raporlama",
      puan: score.regularity,
      tavan: score.weights.regularity,
      aciklama:
        score.expectedDays > 0
          ? `${score.expectedDays} günün ${score.writtenDays}'inde ${raporlamaFiili} · ${yuzde(
              score.writtenDays,
              score.expectedDays,
            )}`
          : "Bu dönemde beklenen iş günü yok.",
      ipucu:
        "Bir günde kaç kayıt yazdığınız değil, kaç farklı günde kayıt yazdığınız ölçülür.",
    },
    score.acceptance !== null
      ? {
          ad: "Kabul oranı",
          puan: score.acceptance,
          tavan: score.weights.acceptance,
          aciklama: `${score.writtenCount} ${kayitIyelik} ${score.approvedCount} tanesi onaylandı.`,
          ipucu:
            "Reddedilen ve düzeltme istenen kayıtlar bu oranı düşürür.",
        }
      : null,
    score.approval !== null
      ? {
          ad: "Onay süresi",
          puan: score.approval,
          tavan: score.weights.approval,
          aciklama: `${score.decidedCount} kararın ${score.decidedOnTimeCount} tanesi zamanında verildi.`,
          ipucu:
            "Ret de karardır; burada ölçülen şey zamanında karar vermektir.",
        }
      : null,
    {
      ad: "Takip disiplini",
      puan: score.followUp,
      tavan: score.weights.followUp,
      aciklama: `${score.followUpTotal} sorumluluktan ${score.followUpHandled} tanesini zamanında ${tamamlamaFiili}.`,
      ipucu: "Sorulara cevap vermek ve takip maddelerini tamamlamak birlikte ölçülür.",
    },
  ].filter(Boolean) as {
    ad: string;
    puan: number;
    tavan: number;
    aciklama: string;
    ipucu: string;
  }[];

  return (
    <div className="flex flex-col gap-4" data-test="skor-karti">
      <div className="flex items-baseline gap-3">
        <span className="mono text-[length:var(--text-3xl)] font-semibold text-ink">
          {score.total}
        </span>
        <span className="text-[length:var(--text-sm)] text-muted">
          Genel puan · bu dönem
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--text-xs)] text-muted">
        <span>Temel puan: {baseTotal} / 100</span>
        <span>
          Takdir katkısı: +{appreciationPoints} puan
          {appreciationCount > 0
            ? ` · ${appreciationCount} takdir × ${appreciationPointsPer}`
            : ""}
        </span>
      </div>

      {appreciationPoints > 0 ? (
        <p className="text-[length:var(--text-xs)] text-muted">
          Genel puan, temel puana verilen takdirlerin katkısı eklenerek hesaplanır;
          bu nedenle 100’ü aşabilir.
        </p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        {boyutlar.map((boyut) => (
          <div
            key={boyut.ad}
            className="rounded-(--radius-sm) border border-line bg-inset/40 px-3.5 py-3"
          >
            <dt className="flex items-baseline justify-between gap-2">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">
                {boyut.ad}
              </span>
              <span className="mono text-[length:var(--text-sm)] text-ink">
                {boyut.puan} / {boyut.tavan}
              </span>
            </dt>
            <dd className="mt-0.5 text-[length:var(--text-xs)] text-muted">
              {boyut.aciklama}
            </dd>
            <dd className="mt-1 text-[length:var(--text-2xs)] leading-snug text-faint">
              {boyut.ipucu}
            </dd>
          </div>
        ))}
      </dl>

      {trend && trend.periods.length > 0 ? (
        <div className="rounded-(--radius-sm) border border-line px-3.5 py-3">
          <p className="text-[length:var(--text-sm)] font-medium text-ink">
            Geçmiş dönemler
          </p>
          {/* Asıl sinyal sıralama değil **eğilim**: "7. sırada" bir şey
              söylemez, "üç dönemdir düşüyor" söyler. */}
          <ol className="mt-2 flex flex-wrap gap-3">
            {trend.periods.map((donem) => (
              <li
                key={donem.periodStart}
                className="text-[length:var(--text-xs)] text-muted"
              >
                <span className="mono text-ink">{donem.total}</span>{" "}
                <span className="text-faint">{donem.periodStart.slice(0, 7)}</span>
              </li>
            ))}
          </ol>
          {trend.declining ? (
            <p className="mt-2 text-[length:var(--text-sm)] text-danger">
              Skor üst üste birkaç dönemdir düşüyor.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
