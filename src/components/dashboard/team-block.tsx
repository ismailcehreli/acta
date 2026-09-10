import type { TeamParticipation } from "@/server/dashboard/summary";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

// Ekip katılımı (§12.1). **Varsayılan kapalıdır** ve yalnız ayardan açılınca
// görünür; gerekçesi kültürel: zorunlu görünürlük, insanları "girmiş olmak
// için" içi boş faaliyet yazmaya itebilir.
//
// Kim yazmadığı **isimle** gösterilmez. Amaç oranı görmek, kişiyi işaretlemek
// değil; isim listesi bu bloğu bir denetim aracına çevirirdi.

export function TeamBlock({ participation }: { participation: TeamParticipation }) {
  const { people, wrote } = participation;
  const oran = people === 0 ? 0 : Math.round((wrote / people) * 100);

  return (
    <Card>
      <CardHeader
        title="Ekip katılımı"
        description="Bugün faaliyet giren kişi sayısı. Bu blok sistem ayarından kapatılabilir."
      />
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular text-ink">
            {wrote}/{people}
          </span>
          <span className="text-sm text-muted">kişi bugün kayıt girdi</span>
        </div>

        <div
          className="h-2 overflow-hidden rounded-full bg-inset"
          role="img"
          aria-label={`Katılım: yüzde ${oran}`}
        >
          <div
            className={oran >= 70 ? "h-full bg-success" : "h-full bg-waiting"}
            style={{ width: `${oran}%` }}
          />
        </div>
      </CardBody>
    </Card>
  );
}
