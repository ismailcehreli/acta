import {
  SETTING_KEYS,
  readNumericSetting,
  type SettingsDb,
} from "@/server/settings/system-settings";

import type { ScoreWeights } from "./compute";


// 23.08.2026 bulgu 8).
//




//




export async function readScoreWeights(db: SettingsDb): Promise<ScoreWeights> {
  const [regularity, acceptance, approval, followUp] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.scoringWeightRegularity),
    readNumericSetting(db, SETTING_KEYS.scoringWeightAcceptance),
    readNumericSetting(db, SETTING_KEYS.scoringWeightApproval),
    readNumericSetting(db, SETTING_KEYS.scoringWeightFollowUp),
  ]);

  return { regularity, acceptance, approval, followUp };
}
