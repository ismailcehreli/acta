import type { FeedCursor } from "./scope-feed";

// İmlecin adres satırındaki gösterimi. Ayrı dosyada tutulur: sayfa bileşeni
// "use server" kısıtları yüzünden yardımcı dışa aktaramaz.
//
// İmleç gizli veri taşımaz — sıralama alanlarından ibarettir — bu yüzden
// imzalanmaz. Bozuk ya da uydurma bir değer listenin başına döner; yetki
// kararı her hâlükârda görünürlük modülünden gelir.

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({
      d: cursor.activityDate.toISOString(),
      c: cursor.createdAt.toISOString(),
      i: cursor.id,
    }),
  ).toString("base64url");
}

export function decodeCursor(value: string | undefined): FeedCursor | null {
  if (!value) return null;

  try {
    const raw: unknown = JSON.parse(Buffer.from(value, "base64url").toString());
    if (typeof raw !== "object" || raw === null) return null;

    const { d, c, i } = raw as Record<string, unknown>;
    if (typeof d !== "string" || typeof c !== "string" || typeof i !== "string") {
      return null;
    }

    const activityDate = new Date(d);
    const createdAt = new Date(c);
    if (Number.isNaN(activityDate.getTime()) || Number.isNaN(createdAt.getTime())) {
      return null;
    }

    return { activityDate, createdAt, id: i };
  } catch {
    return null;
  }
}
