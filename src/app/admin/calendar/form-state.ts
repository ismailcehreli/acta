// Sunucu eylemi dosyaları yalnız `async` fonksiyon dışa aktarabilir
// ("use server"); durum nesneleri ayrı dosyada durur.

export interface CalendarFormState {
  error: string | null;
  success: string | null;
}

export const emptyCalendarFormState: CalendarFormState = {
  error: null,
  success: null,
};
