import type { TrendSummary } from "@/server/dashboard/charts";
import { formatDayShort, formatWeekday, toDateValue } from "@/shared/format/date-time";

// Günlük kayıt sayısı — sütun grafiği ve özet satırı.
//
// **Neden elle yazılmış SVG:** grafik kitaplığı hem sayfaya yüzlerce kilobayt
// istemci kodu ekler hem de kendi görsel dilini getirir. Buradaki iş bir eksen
// ve birkaç dikdörtgen; sistemin kural çizgisi diliyle çizilebiliyor. Sunucuda
// render ediliyor, tarayıcıya JavaScript inmiyor.
//
// **Grafik tek başına bir şey söylemez.** "30 kayıt" iyi mi kötü mü belli
// değildir; bu yüzden çubukların üstünde dört ölçü duruyor: toplam, geçen
// döneme göre değişim, çalışma günü ortalaması ve kayıt girilmemiş gün sayısı.
// Ortalama çizgisi de grafiğin içinde: her sütun neye göre yüksek ya da alçak,
// göz doğrudan görüyor.
//
// **Erişilebilirlik renge bağlı değil:** grafiğin yanında aynı veriyi taşıyan
// gizli bir tablo duruyor. Ekran okuyucu kullanan kişi çubukları değil
// sayıları okur.

const YUKSEKLIK = 100;
const SUTUN_ARALIK = 100;

function gunEtiketi(day: string): string {
  return formatDayShort(toDateValue(day));
}

function haftaGunu(day: string): string {
  return formatWeekday(toDateValue(day));
}

function haftaSonuMu(day: string): boolean {
  const gun = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return gun === 0 || gun === 6;
}

export function TrendChart({ trend }: { trend: TrendSummary }) {
  const { points, total, workdayAverage, busiest, changePercent, emptyWorkdays } =
    trend;

  const enBuyuk = Math.max(1, ...points.map((p) => p.count));
  const genislik = points.length * SUTUN_ARALIK;
  const ortalamaY = YUKSEKLIK - (workdayAverage / enBuyuk) * (YUKSEKLIK - 12);

  return (
    <div>
      {/* Özet ölçüler: grafiğin okunması için gereken bağlam. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Olcu etiket={`Son ${points.length} gün`} deger={String(total)} ek="kayıt" />
        <Olcu
          etiket="Geçen döneme göre"
          deger={
            changePercent === null
              ? "—"
              : `${changePercent > 0 ? "+" : ""}%${changePercent}`
          }
          ek={changePercent === null ? "karşılaştırma yok" : undefined}
          ton={
            changePercent === null
              ? undefined
              : changePercent >= 0
                ? "success"
                : "danger"
          }
        />
        <Olcu
          etiket="Çalışma günü ortalaması"
          deger={workdayAverage.toLocaleString("tr-TR")}
          ek="kayıt/gün"
        />
        <Olcu
          etiket="Kayıt girilmeyen gün"
          deger={String(emptyWorkdays)}
          ek={emptyWorkdays === 0 ? "hepsinde kayıt var" : "çalışma günü"}
          ton={emptyWorkdays > 0 ? "correction" : undefined}
        />
      </dl>

      {/* Kaydırma **kartın içinde** kalmalı: 14 günlük grafiğin okunabilir bir
          taban genişliği var ve telefonda sayfanın kendisi yana kaymamalı.
          `min-w-0` olmadan ızgara çocuğu içerik genişliğine kilitlenir. */}
      <div className="mt-5 min-w-0 overflow-x-auto">
        <svg
          aria-hidden
          viewBox={`0 0 ${genislik} ${YUKSEKLIK}`}
          preserveAspectRatio="none"
          className="h-36 w-full min-w-[520px]"
          role="presentation"
        >
          {points.map((point, i) =>
            haftaSonuMu(point.day) ? (
              // Hafta sonu zemini: boş gün "kimse yazmamış" değil,
              // "çalışılmamış" olabilir.
              <rect
                key={`zemin-${point.day}`}
                x={i * SUTUN_ARALIK}
                y="0"
                width={SUTUN_ARALIK}
                height={YUKSEKLIK}
                fill="var(--color-inset)"
              />
            ) : null,
          )}

          {points.map((point, i) => {
            const yukseklik =
              point.count === 0 ? 0 : (point.count / enBuyuk) * (YUKSEKLIK - 12);
            const sonGun = i === points.length - 1;
            const enYogun = busiest !== null && point.day === busiest.day;

            if (yukseklik === 0) return null;

            return (
              <rect
                key={point.day}
                x={i * SUTUN_ARALIK + 20}
                y={YUKSEKLIK - yukseklik}
                width={SUTUN_ARALIK - 40}
                height={yukseklik}
                fill={
                  sonGun || enYogun
                    ? "var(--color-primary)"
                    : "var(--color-line-strong)"
                }
              />
            );
          })}

          {/* Ortalama çizgisi: sütunlar neye göre yüksek, göz doğrudan görsün. */}
          {workdayAverage > 0 ? (
            <line
              x1="0"
              y1={ortalamaY}
              x2={genislik}
              y2={ortalamaY}
              stroke="var(--color-primary)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.55"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* Taban kuralı: sütunlar havada durmasın. */}
          <line
            x1="0"
            y1={YUKSEKLIK}
            x2={genislik}
            y2={YUKSEKLIK}
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Eksen etiketleri SVG dışında: ölçeklenen bir viewBox içinde yazı
            eğilip bulanıklaşır. */}
        <div className="mt-1.5 flex min-w-[520px]">
          {points.map((point, i) => {
            const vurgulu =
              i === points.length - 1 || (busiest !== null && point.day === busiest.day);

            return (
              <span
                key={point.day}
                className={`flex flex-1 flex-col items-center gap-0.5 text-[length:var(--text-2xs)] ${
                  vurgulu ? "font-semibold text-ink" : "text-faint"
                }`}
              >
                <span className="tabular">{point.count > 0 ? point.count : "·"}</span>
                <span>{gunEtiketi(point.day)}</span>
              </span>
            );
          })}
        </div>
      </div>

      {busiest && busiest.count > 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-[length:var(--text-xs)] text-muted">
          En yoğun gün{" "}
          <strong className="font-semibold text-ink">
            {gunEtiketi(busiest.day)} {haftaGunu(busiest.day)}
          </strong>{" "}
          — <span className="tabular">{busiest.count}</span> kayıt. Kesikli çizgi
          çalışma günü ortalamasıdır.
        </p>
      ) : null}

      {/* Aynı veri, sayı olarak. Grafik bir özet; kaynak budur. */}
      <table className="sr-only">
        <caption>Günlere göre kayıt sayısı</caption>
        <thead>
          <tr>
            <th scope="col">Gün</th>
            <th scope="col">Kayıt</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">
                {gunEtiketi(point.day)} {haftaGunu(point.day)}
              </th>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Grafiğin üstündeki tek ölçü. Sayı büyük, etiket küçük, ek gri. */
function Olcu({
  etiket,
  deger,
  ek,
  ton,
}: {
  etiket: string;
  deger: string;
  ek?: string;
  ton?: "success" | "danger" | "correction";
}) {
  const renk =
    ton === "success"
      ? "text-success"
      : ton === "danger"
        ? "text-danger"
        : ton === "correction"
          ? "text-correction"
          : "text-ink";

  return (
    <div>
      <dt className="section-label">{etiket}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`tabular text-[length:var(--text-xl)] font-semibold ${renk}`}>
          {deger}
        </span>
        {ek ? (
          <span className="text-[length:var(--text-xs)] text-faint">{ek}</span>
        ) : null}
      </dd>
    </div>
  );
}
