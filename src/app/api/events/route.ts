import { getCurrentUser } from "@/server/auth/current-user";
import { REALTIME_EVENTS, type RealtimeEvent } from "@/server/realtime/events";
import { subscribe } from "@/server/realtime/hub";

// Sunucudan istemciye olay akışı (§13, Görev 7.3).
//
// Akış **oturuma bağlıdır**: kullanıcı kimliği çerezden okunur, istemciden
// gelen hiçbir değer alıcıyı belirlemez. Kimliğini kendi söyleyebilen bir uç,
// başkasının akışını dinlemenin en kısa yolu olurdu.
//
// Gövde içerik taşımaz; yalnızca "değişti" der (bkz. `realtime/events.ts`).

export const dynamic = "force-dynamic";

/**
 * Ters vekil ve tarayıcı, sessiz kalan bir bağlantıyı kapatır. Yorum satırı
 * (`:` ile başlayan) olay sayılmaz; sadece hattı açık tutar.
 */
const HEARTBEAT_MS = 25_000;

function sseVeri(event: RealtimeEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();

  // Oturumsuz istek akış açmaz. 401 burada bilgi sızdırmaz: kullanıcının
  // kendi oturumunun durumu zaten kendisine ait.
  if (!user) {
    return new Response("Oturum gerekli.", { status: 401 });
  }

  const userId = user.id;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let kapandi = false;

      /**
       * Kaynakları bırakır. `controller.close()` **çağrılmaz**: bağlantı karşı
       * taraftan koptuğunda akışı bizim kapatmaya çalışmamız, Next'in yazma
       * hattında "The destination stream closed early" hatasına dönüşüyor ve
       * her sekme kapanışı sunucu günlüğüne hata olarak düşüyordu. Kopan
       * bağlantıda akışı platform kendisi iptal ediyor (`cancel`).
       */
      const kapat = () => {
        if (kapandi) return;
        kapandi = true;

        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
      };

      /** Yalnızca hata yolunda: akışı biz sonlandırmak zorundayız. */
      const hatayaKapat = () => {
        kapat();
        try {
          controller.close();
        } catch {
          // Akış karşı taraftan zaten kapanmış olabilir.
        }
      };

      const yaz = (metin: string) => {
        // Tarayıcı bağlantıyı kesmişse hiç yazmaya kalkışılmaz. `enqueue`
        // hemen fırlatmıyor; alttaki akış sonradan hata veriyor ve Next bunu
        // uygulama hatası olarak günlüğe basıyordu ("The destination stream
        // closed early"). Gerçek hataların arasında kaybolmasın diye kaynakta
        // engelleniyor.
        if (kapandi || request.signal.aborted) {
          kapat();
          return;
        }
        try {
          controller.enqueue(encoder.encode(metin));
        } catch {
          // Yazılamıyorsa bağlantı gitmiştir; kaynakları bırak.
          kapat();
        }
      };

      // Tarayıcı bağlantı koptuğunda kendi yeniden dener; aralığı biz veririz.
      yaz("retry: 3000\n\n");

      try {
        unsubscribe = await subscribe(userId, (event) => yaz(sseVeri(event)));
      } catch (error) {
        // Dinleyici kurulamadıysa akış **açık bırakılmaz**. Sessizce boş bir
        // akış vermek, "gerçek zamanlı çalışıyor" yanılsaması üretirdi.
        console.error("[realtime] abone olunamadı:", error);
        yaz("event: error\ndata: {}\n\n");
        hatayaKapat();
        return;
      }

      // İlk işaret: istemci akışın gerçekten kurulduğunu bilir ve kopukluk
      // sırasında kaçırdığı olabilecek değişiklikler için bir kez tazeler.
      yaz(sseVeri({ kind: REALTIME_EVENTS.reconnected }));

      heartbeat = setInterval(() => yaz(": ping\n\n"), HEARTBEAT_MS);

      request.signal.addEventListener("abort", kapat);
      if (request.signal.aborted) kapat();
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // Ara belleklere hiçbir koşulda düşmemeli: akış kişiye özeldir.
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Nginx ve benzeri vekiller yanıtı tamponlamasın; tamponlanan bir akış
      // gerçek zamanlı olmaz (§15.5, ters vekil arkasında çalışacak).
      "X-Accel-Buffering": "no",
    },
  });
}
