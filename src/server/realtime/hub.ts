import { Client } from "pg";

import {
  REALTIME_CHANNEL,
  REALTIME_EVENTS,
  realtimeNotifySchema,
  type RealtimeEvent,
} from "./events";

// Dinleyici (§13, Görev 7.3).
//
// Web sürecinde **tek** bir PostgreSQL bağlantısı `LISTEN` yapar ve gelen
// bildirimi açık SSE akışlarına dağıtır. Her tarayıcı sekmesi için ayrı bir
// veritabanı bağlantısı açmak, elli kişilik bir şirkette havuzu tüketirdi.
//
// Prisma bu işi yapamaz: `LISTEN` bağlantının ömrü boyunca açık kalmayı
// gerektirir, Prisma ise havuzdan aldığı bağlantıyı sorgu bitince geri verir.
// Bu yüzden `pg` doğrudan kullanılıyor — onaylanan LISTEN/NOTIFY kararının
// zorunlu sonucu.

type Listener = (event: RealtimeEvent) => void;

interface Hub {
  /** Kullanıcı kimliği → o kullanıcının açık akışları. */
  aboneler: Map<string, Set<Listener>>;
  client: Client | null;
  /** Bağlanma denemesi sürüyorsa aynı sözü paylaşır; iki bağlantı açılmaz. */
  baglaniyor: Promise<void> | null;
  yenidenDenemeGecikmesi: number;
  kapaniyor: boolean;
}

const ILK_GECIKME_MS = 500;
const AZAMI_GECIKME_MS = 30_000;

// Geliştirme modunda modül yeniden yüklendiğinde ikinci bir dinleyici açılmasın
// diye hub global nesnede tutulur — `db.ts` ile aynı gerekçe.
const globalForHub = globalThis as unknown as { realtimeHub: Hub | undefined };

const hub: Hub = (globalForHub.realtimeHub ??= {
  aboneler: new Map(),
  client: null,
  baglaniyor: null,
  yenidenDenemeGecikmesi: ILK_GECIKME_MS,
  kapaniyor: false,
});

function log(mesaj: string): void {
  console.log(`[realtime] ${new Date().toISOString()} ${mesaj}`);
}

/** Olayı yalnızca **adı geçen** kullanıcıların akışlarına yazar. */
function dagit(userIds: string[], event: RealtimeEvent): void {
  for (const userId of userIds) {
    const kume = hub.aboneler.get(userId);
    if (!kume) continue;

    for (const listener of kume) {
      try {
        listener(event);
      } catch (error) {
        // Bir akışın hatası diğerlerini düşürmemeli; ama sessiz de geçilmemeli.
        log(`akışa yazılamadı: ${String(error)}`);
      }
    }
  }
}

/** Açık bütün akışlara gönderir. Yalnızca yeniden bağlanma işareti için. */
function hepsineDagit(event: RealtimeEvent): void {
  for (const kume of hub.aboneler.values()) {
    for (const listener of kume) {
      try {
        listener(event);
      } catch (error) {
        log(`akışa yazılamadı: ${String(error)}`);
      }
    }
  }
}

function onNotification(payload: string | undefined): void {
  if (!payload) return;

  let ham: unknown;
  try {
    ham = JSON.parse(payload);
  } catch {
    log("bozuk yük (JSON değil) — atlandı");
    return;
  }

  const sonuc = realtimeNotifySchema.safeParse(ham);
  if (!sonuc.success) {
    // Kanalı başka bir süreç de besleyebilir. Tanımadığımız yükü **işlemeyiz**
    // ama görmezden de gelmeyiz: günlüğe düşer.
    log(`tanınmayan yük — atlandı: ${sonuc.error.issues[0]?.message ?? ""}`);
    return;
  }

  dagit(sonuc.data.userIds, { kind: sonuc.data.kind });
}

async function baglan(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL tanımlı değil; gerçek zamanlı akış kurulamaz.");
  }

  const client = new Client({ connectionString });

  client.on("notification", (message) => {
    if (message.channel !== REALTIME_CHANNEL) return;
    onNotification(message.payload);
  });

  client.on("error", (error) => {
    log(`bağlantı hatası: ${error.message}`);
    void yenidenBagla();
  });

  await client.connect();
  await client.query(`LISTEN ${REALTIME_CHANNEL}`);

  hub.client = client;
  hub.yenidenDenemeGecikmesi = ILK_GECIKME_MS;
  log("dinleniyor");
}

async function yenidenBagla(): Promise<void> {
  if (hub.kapaniyor) return;

  const eski = hub.client;
  hub.client = null;
  hub.baglaniyor = null;

  if (eski) {
    // Kapanma hatası yutulur: bağlantı zaten kopuk olabilir.
    await eski.end().catch(() => undefined);
  }

  if (hub.aboneler.size === 0) return;

  const gecikme = hub.yenidenDenemeGecikmesi;
  hub.yenidenDenemeGecikmesi = Math.min(gecikme * 2, AZAMI_GECIKME_MS);

  await new Promise((resolve) => setTimeout(resolve, gecikme));
  if (hub.kapaniyor || hub.aboneler.size === 0) return;

  try {
    await baglantiyiSagla();
    // Kopukluk boyunca gelen olaylar kayboldu. Açık akışlara koşulsuz tazeleme
    // işareti gönderilir; eksik kalmaktansa bir kez fazladan tazelensin.
    hepsineDagit({ kind: REALTIME_EVENTS.reconnected });
  } catch (error) {
    log(`yeniden bağlanamadı: ${String(error)}`);
    void yenidenBagla();
  }
}

function baglantiyiSagla(): Promise<void> {
  if (hub.client) return Promise.resolve();
  hub.baglaniyor ??= baglan().finally(() => {
    hub.baglaniyor = null;
  });
  return hub.baglaniyor;
}

/**
 * Kullanıcı adına akış açar. Dönen fonksiyon aboneliği kapatır.
 *
 * Abone yoksa bağlantı da kapatılır: kimsenin dinlemediği bir `LISTEN`
 * bağlantısını açık tutmak, boşuna bir bağlantı tutmak demek.
 */
export async function subscribe(
  userId: string,
  listener: Listener,
): Promise<() => void> {
  const kume = hub.aboneler.get(userId) ?? new Set<Listener>();
  kume.add(listener);
  hub.aboneler.set(userId, kume);

  try {
    await baglantiyiSagla();
  } catch (error) {
    // Bağlantı kurulamadıysa abonelik geri alınır; yarım bir kayıt bırakılmaz.
    kume.delete(listener);
    if (kume.size === 0) hub.aboneler.delete(userId);
    throw error;
  }

  return () => {
    const mevcut = hub.aboneler.get(userId);
    if (!mevcut) return;

    mevcut.delete(listener);
    if (mevcut.size === 0) hub.aboneler.delete(userId);

    if (hub.aboneler.size === 0 && hub.client) {
      const client = hub.client;
      hub.client = null;
      void client.end().catch(() => undefined);
      log("abone kalmadı, bağlantı kapatıldı");
    }
  };
}

/** Testlerin ve kapanış sinyalinin kullandığı temizlik. */
export async function shutdownRealtimeHub(): Promise<void> {
  hub.kapaniyor = true;
  hub.aboneler.clear();

  const client = hub.client;
  hub.client = null;
  hub.baglaniyor = null;

  if (client) await client.end().catch(() => undefined);
  hub.kapaniyor = false;
  hub.yenidenDenemeGecikmesi = ILK_GECIKME_MS;
}

/** Testler için: kaç akış açık? */
export function subscriberCount(): number {
  let toplam = 0;
  for (const kume of hub.aboneler.values()) toplam += kume.size;
  return toplam;
}
