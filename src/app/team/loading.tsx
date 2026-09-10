import { Spinner } from "@/components/system/status-page";

// Bu segmentin bekleme yüzeyi (Görev 10.1).
//
// **Neden kökte değil:** `loading.tsx` yanıtı akışa çevirir ve HTTP başlığı
// sayfa çizilmeden gönderilir. Kökte durduğunda `notFound()` çağıran sayfalar
// 404 yerine **200** dönüyordu — uçtan uca test bunu yakaladı. Bu yüzden
// bekleme yüzeyi yalnız `notFound()` çağırmayan segmentlerde durur.
// `notFound()` çağıranlar: /activities/[id] ve alt yolları, /users/[id].

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <Spinner label="Yükleniyor…" />
    </div>
  );
}
