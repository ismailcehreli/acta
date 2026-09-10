import type { PrismaClient } from "@prisma/client";

import { resolveManagers } from "./resolve-manager";

// "Bu kişi şu kişinin üst zincirinde mi?" sorusu. İptal yetkisi (§5.5) ve
// görünürlük (§8.1) bu soruya dayanır; kural §4.4'teki yönetici türetmesinin
// tekrar tekrar uygulanmasından ibarettir ve kopyalanmaz.
//
// **Zincir artık bir çizgi değil, bir ağaç** (20.08.2026 kararı): bir birimde
// birden fazla yönetici olabildiği için her kademede birden çok üst çıkabilir.
// Bu yüzden yürüyüş genişlik öncelikli ve ziyaret edilen kimlikler takip
// ediliyor — aynı kişiye iki yoldan ulaşmak (matris benzeri ağaçlarda olur)
// sonsuz döngüye dönüşmemeli.

export type ChainDb = Pick<PrismaClient, "user" | "orgUnit">;

/** Ağaç bütünlüğü veritabanınca korunuyor; bu yalnızca sonsuz döngü ağıdır. */
const MAX_LEVELS = 20;

/** Kişinin bütün üstleri, en yakın kademeden köke doğru. */
export async function managementChain(
  db: ChainDb,
  personId: string,
): Promise<string[]> {
  const gorulen = new Set<string>([personId]);
  const zincir: string[] = [];

  let kademe: string[] = [personId];

  for (let level = 0; level < MAX_LEVELS && kademe.length > 0; level += 1) {
    const sonraki: string[] = [];

    for (const kisiId of kademe) {
      const ustler = await resolveManagers(db, kisiId);
      if (!ustler.found) continue;

      for (const ustId of ustler.managerIds) {
        if (gorulen.has(ustId)) continue;

        gorulen.add(ustId);
        zincir.push(ustId);
        sonraki.push(ustId);
      }
    }

    kademe = sonraki;
  }

  return zincir;
}

/**
 * `candidateId`, `personId` kişisinin üstündeki yöneticilerden biri mi?
 * Kişinin kendisi kendi üstü sayılmaz.
 */
export async function isInManagementChain(
  db: ChainDb,
  personId: string,
  candidateId: string,
): Promise<boolean> {
  if (personId === candidateId) return false;

  const gorulen = new Set<string>([personId]);
  let kademe: string[] = [personId];

  for (let level = 0; level < MAX_LEVELS && kademe.length > 0; level += 1) {
    const sonraki: string[] = [];

    for (const kisiId of kademe) {
      const ustler = await resolveManagers(db, kisiId);
      if (!ustler.found) continue;

      for (const ustId of ustler.managerIds) {
        if (ustId === candidateId) return true;
        if (gorulen.has(ustId)) continue;

        gorulen.add(ustId);
        sonraki.push(ustId);
      }
    }

    kademe = sonraki;
  }

  return false;
}
