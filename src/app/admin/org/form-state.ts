// Form durumu, sunucu eylemlerinden ayrı dosyada tutulur: "use server" işaretli
// bir dosya yalnızca async fonksiyon dışa aktarabilir, sabit nesne aktaramaz.

/** Ekranda gösterilecek mesai penceresi özeti. */
export interface WorkWindowSummary {
  days: string;
  hours: string;
  holidays: string;
  source: string;
}

export interface OrgFormState {
  error: string | null;
  success: string | null;
  /**
   * Taşıma mesai penceresini değiştiriyorsa onay adımının verileri
   * (tasarım Paket H; denetim 23.08.2026, bulgu 14).
   */
  calendarConfirm?: {
    unitId: string;
    newParentId: string;
    signature: string;
    before: WorkWindowSummary;
    after: WorkWindowSummary;
  };
}

export const emptyOrgFormState: OrgFormState = { error: null, success: null };
