import Link from "next/link";

import type { DashboardMetrics } from "@/server/dashboard/metrics";

// Ana ekranın ölçüm şeridi.
//
// Dekoratif "istatistik kartı" koleksiyonu değil: yan yana okunan, aynı
// hizada duran sayılar. Her sayı bir soruya cevap verir ve **tıklanabilir** —
// "3 onay bekliyor" gördükten sonra kullanıcının o listeyi elle bulması
// gerekmiyor.
//
// Sıfır olan sayı da gösterilir; şeridin sütun sayısı sayfadan sayfaya
// değişirse göz her seferinde yeniden hizalanmak zorunda kalır. Ama sıfır
// **sessizdir**: rengi yoktur, dikkat çekmez.
//
// Her ölçüm **kendi listesini** açar. Önce üçü `/?period=…#kapsam` adresine
// gidiyordu — yani aynı sayfada bir bölüme atlıyordu; kullanıcı filtrelenmiş
// bir liste beklerken sayfa aşağı kayıyordu. Bir sayı soruya cevap veriyorsa,
// tıklama o cevabın dayanağını göstermeli (Görev 11.2). Kişisel şerit kendi
// arşivine, yönetilen şerit yönetim akışına gider; iki bağlantı ailesi
// birbirine karıştırılmaz.
//
// **Sıfır sayaç da tıklanabilir.** Önceki kural ("sıfırken bağlantı verilmez")
// kaldırıldı: boş bir liste yalan söylemez, kullanıcıya nerede olduğunu ve
// süzgeci nasıl gevşeteceğini gösterir. Bağlantının kaybolması, aradığı şeyin
// nerede olduğunu öğrenmesini engelliyordu.

interface Olcum {
  etiket: string;
  deger: number;
  ipucu?: string;
  href?: string;
  /** Sıfırdan büyükken vurgulanacak ton. */
  ton?: "primary" | "correction" | "danger";
}

export function MetricStrip({
  metrics,
  donemEtiketi,
  period,
  onaylayici,
  headingId = "olcum-basligi",
  ownOnly = false,
  authorId,
}: {
  metrics: DashboardMetrics;
  donemEtiketi: string;
  /** Daraltma bağlantılarında korunacak dönem. */
  period: string;
  /** Bu kişinin onay görevi var mı; "Onay bekleyen" bağlantısı buna göre. */
  onaylayici: boolean;
  /** Aynı sayfada birden fazla şerit olduğunda erişilebilir başlık kimliği. */
  headingId?: string;
  /** Bağlantıları yalnız oturum sahibinin kayıtlarına daraltır. */
  ownOnly?: boolean;
  /** `ownOnly` açıkken kullanılacak yazar kimliği. */
  authorId?: string;
}) {
  // Bağlantılar dönemi korur: kullanıcı "Bu hafta"ya bakarken sayaca
  // tıklayınca ay başına atlamaz.
  const akis = (ek: Record<string, string> = {}) =>
    `/feed?${new URLSearchParams({
      period,
      ...ek,
    }).toString()}`;
  const kendiArsivim = (ek: Record<string, string> = {}) =>
    `/activities?${new URLSearchParams({ period, ...ek }).toString()}`;
  const liste = (ek: Record<string, string> = {}) =>
    ownOnly ? kendiArsivim(ek) : akis(ek);

  const olcumler: Olcum[] = [
    {
      etiket: `${donemEtiketi} yazılan`,
      deger: metrics.activities,
      ipucu:
        metrics.contributors > 0
          ? `${metrics.contributors} kişi yazdı`
          : "Bu aralıkta kayıt yok",
      href: liste(),
    },
    {
      etiket: "Onay bekleyen",
      deger: metrics.pendingApproval,
      ipucu: onaylayici
        ? "Kararınızı bekliyor"
        : "Yöneticisine düşmüş, henüz karara bağlanmamış",
      // Yönetilen şeritte onay görevi olan kişi doğrudan onay kuyruğuna
      // gider; olmayan kişi aynı kayıtları yönetim akışında görür. Kişisel
      // şerit ise her durumda kendi arşivindeki bekleyen kayda gider.
      href: !ownOnly && onaylayici ? "/approvals" : liste({ durum: "onay" }),
      ton: "primary",
    },
    {
      etiket: "Düzeltme istenen",
      deger: metrics.correctionRequested,
      ipucu: "Yazarına geri gönderildi, yeniden gönderilmesi bekleniyor",
      href: liste({ durum: "duzeltme" }),
      ton: "correction",
    },
    {
      etiket: "Cevap bekleyen faaliyet",
      deger: metrics.openQuestions,
      ipucu:
        "Başkasının sorduğu açık sorusu olan faaliyetler; her faaliyet bir kez sayılır",
      // Açık işler dönemden bağımsızdır: eski bir soruyu bu haftanın
      // seçili dönemi yüzünden sayaçtan açılan listede saklamayalım.
      href: liste({ period: "all", durum: "soru" }),
      ton: "primary",
    },
    {
      etiket: "Açık takip",
      deger: metrics.openFollowUps,
      ipucu:
        metrics.staleFollowUps > 0
          ? `${metrics.staleFollowUps} tanesi ${metrics.staleThreshold} iş günüdür bekliyor`
          : `Hiçbiri ${metrics.staleThreshold} iş gününden uzun süredir beklemiyor`,
      href: ownOnly && authorId
        ? `/follow-ups?sorumlu=${encodeURIComponent(authorId)}`
        : "/follow-ups",
      ton: metrics.staleFollowUps > 0 ? "danger" : "primary",
    },
  ];

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Özet sayılar
      </h2>
      <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-5">
        {olcumler.map((olcum) => (
          <Olcuk key={olcum.etiket} olcum={olcum} />
        ))}
      </dl>
    </section>
  );
}

function Olcuk({ olcum }: { olcum: Olcum }) {
  const vurgu = olcum.deger > 0 && olcum.ton;
  const renk =
    vurgu === "danger"
      ? "text-danger"
      : vurgu === "correction"
        ? "text-correction"
        : vurgu === "primary"
          ? "text-primary"
          : "text-ink";

  const govde = (
    <>
      <dt className="section-label">{olcum.etiket}</dt>
      <dd className={`mt-1 text-[length:var(--text-2xl)] font-semibold tabular ${renk}`}>
        {olcum.deger}
      </dd>
      {olcum.ipucu ? (
        <p className="mt-0.5 text-[length:var(--text-2xs)] leading-[var(--leading-snug)] text-faint">
          {olcum.ipucu}
        </p>
      ) : null}
    </>
  );

  // Sıfır sayaç da bağlantılıdır: boş liste kullanıcıya süzgeci ve onu
  // temizleme yolunu gösterir (Görev 11.2).
  if (olcum.href) {
    return (
      <div className="border-line not-last:border-e">
        <Link
          href={olcum.href}
          className="block px-3 py-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
        >
          {govde}
        </Link>
      </div>
    );
  }

  return <div className="border-line px-3 py-3 not-last:border-e">{govde}</div>;
}
