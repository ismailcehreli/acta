import { getCurrentUser } from "@/server/auth/current-user";
import { getTranslations } from "@/server/i18n/server";
import { REALTIME_EVENTS, type RealtimeEvent } from "@/server/realtime/events";
import { subscribe } from "@/server/realtime/hub";


//



//


export const dynamic = "force-dynamic";


const HEARTBEAT_MS = 25_000;

function sseData(event: RealtimeEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  const t = await getTranslations();

  // Unauthenticated requests cannot open a stream. The 401 response reveals
  // no information because the session belongs to the requester.
  if (!user) {
    return new Response(t("errors.api.authenticationRequired"), { status: 401 });
  }

  const userId = user.id;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      /**
       * Releases resources. Do not call `controller.close()`: when the remote
       * side disconnects, closing the stream here causes a "destination stream
       * closed early" error in Next's write path. The platform cancels the
       * stream when the connection is gone.
       */
      const closeResources = () => {
        if (closed) return;
        closed = true;

        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
      };

      /** Error path only: the server must terminate the stream. */
      const closeOnError = () => {
        closeResources();
        try {
          controller.close();
        } catch {
          // The remote side may already have closed the stream.
        }
      };

      const write = (text: string) => {
        // Do not enqueue after the browser disconnects. The error can surface
        // later in the stream and look like an application failure in Next.
        if (closed || request.signal.aborted) {
          closeResources();
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // A failed write means the connection is gone; release resources.
          closeResources();
        }
      };

      // The browser retries after a disconnect; this tells it the retry delay.
      write("retry: 3000\n\n");

      try {
        unsubscribe = await subscribe(userId, (event) => write(sseData(event)));
      } catch (error) {
        // Do not leave the stream open when the subscription cannot be created.
        console.error("[realtime] subscription failed:", error);
        write("event: error\ndata: {}\n\n");
        closeOnError();
        return;
      }

      // The first event confirms that the stream is established. The client
      // refreshes once to recover changes that may have been missed while away.
      write(sseData({ kind: REALTIME_EVENTS.reconnected }));

      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      request.signal.addEventListener("abort", closeResources);
      if (request.signal.aborted) closeResources();
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
      // Never cache this stream: it is user-specific.
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Prevent reverse proxies such as Nginx from buffering the response;
      // a buffered stream is not real-time (§15.5).
      "X-Accel-Buffering": "no",
    },
  });
}
