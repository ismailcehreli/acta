import { Badge, type BadgeTone } from "@/components/ui/badge";

// Faaliyet yaşam döngüsü durumları (§9).
//
// Metinler brief §9'un sözlüğünü kullanır ve kullanıcının üç sorusuna cevap
// verecek biçimde seçilmiştir: ne oldu, kimden eylem bekleniyor, şimdi ne
// yapabilirim. "kayıtlı" yerine "onaylandı" denir — kaydın onay sürecinden
// geçtiği bilgisi kullanıcı için taşıyıcıdır.
//
// Durum **yalnız renkle** anlatılmaz: her rozetin metni ve tona özgü ikonu
// vardır (bkz. `Badge`).

const DURUM: Record<string, { metin: string; tone: BadgeTone }> = {
  APPROVED: { metin: "Onaylandı", tone: "success" },
  PENDING_APPROVAL: { metin: "Onay bekliyor", tone: "waiting" },
  CHANGES_REQUESTED: { metin: "Düzeltme istendi", tone: "correction" },
  MANAGER_NOT_FOUND: { metin: "Yönetici bulunamadı", tone: "danger" },
  REJECTED: { metin: "Uygun bulunmadı", tone: "danger" },
  CANCELLED: { metin: "İptal edildi", tone: "cancelled" },
  DRAFT: { metin: "Taslak", tone: "neutral" },
};

export function durumMetni(status: string): string {
  return DURUM[status]?.metin ?? status;
}

export function ApprovalBadge({ status }: { status: string }) {
  const durum = DURUM[status] ?? { metin: status, tone: "neutral" as BadgeTone };
  return <Badge tone={durum.tone}>{durum.metin}</Badge>;
}
