import { Spinner } from "@/components/system/status-page";

// Bu segmentin bekleme yüzeyi (Görev 15.1, DESIGN-IS-2026-09-02).
//
// **Neden burada güvenli:** `/approvals` alt ağacında `notFound()` çağıran
// hiçbir dosya yok (bkz. `src/app/admin/loading.tsx`'teki aynı gerekçe —
// kök ve `/activities` için bu dosya **kasıtlı olarak** eklenmedi, çünkü o
// ikisinin alt ağacında `notFound()` çağıran rotalar var ve bekleme yüzeyi
// yanıtı akışa çevirdiği için 404 yerine 200 dönmesine yol açıyordu).

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <Spinner label="Yükleniyor…" />
    </div>
  );
}
