import {
  SETTING_KEYS,
  readNumericSetting,
  type SettingsDb,
} from "@/server/settings/system-settings";

import type { ScoreWeights } from "./compute";

// Skor ağırlıklarının **ayardan** okunması (Görev 11.10, denetim
// 23.08.2026 bulgu 8).
//
// Ağırlıklar koda gömülüydü: formülü değiştirmek dağıtım gerektiriyordu.
// Tasarım (satır 672-686) dördünü de `SystemSetting` olarak tanımlıyor ve
// **temel skor için her üç profilde toplamın 100 olmasını** zorunlu kılıyor; çapraz doğrulama
// kaydetme sınırında, `SETTING_SUM_RULES` ile yapılıyor.
//
// Okuma burada tek yerde: hesaplayıcı saf kalıyor ve ayarları kendisi
// aramıyor. İki taraf ayrı okusaydı, biri değiştiğinde kapanış ile canlı
// hesap sessizce ayrışırdı.

export async function readScoreWeights(db: SettingsDb): Promise<ScoreWeights> {
  const [regularity, acceptance, approval, followUp] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.scoringWeightRegularity),
    readNumericSetting(db, SETTING_KEYS.scoringWeightAcceptance),
    readNumericSetting(db, SETTING_KEYS.scoringWeightApproval),
    readNumericSetting(db, SETTING_KEYS.scoringWeightFollowUp),
  ]);

  return { regularity, acceptance, approval, followUp };
}
