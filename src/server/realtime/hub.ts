import { Client } from "pg";

import {
  REALTIME_CHANNEL,
  REALTIME_EVENTS,
  realtimeNotifySchema,
  type RealtimeEvent,
} from "./events";


//



//



// Subscribers must observe the result of every delivered event.

type Listener = (event: RealtimeEvent) => void;

interface Hub {

  subscribers: Map<string, Set<Listener>>;
  client: Client | null;

  connecting: Promise<void> | null;
  reconnectDelay: number;
  shuttingDown: boolean;
}

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;



const globalForHub = globalThis as unknown as { realtimeHub: Hub | undefined };

const hub: Hub = (globalForHub.realtimeHub ??= {
  subscribers: new Map(),
  client: null,
  connecting: null,
  reconnectDelay: INITIAL_RECONNECT_DELAY_MS,
  shuttingDown: false,
});

function log(message: string): void {
  console.log(`[realtime] ${new Date().toISOString()} ${message}`);
}

/** Writes an event only to the streams of the named users. */
function dispatch(userIds: string[], event: RealtimeEvent): void {
  for (const userId of userIds) {
    const listeners = hub.subscribers.get(userId);
    if (!listeners) continue;

    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        // One stream must not take down the others, but failures must remain
        // visible in the worker log.
        log(`stream write failed: ${String(error)}`);
      }
    }
  }
}

/** Sends an event to every open stream, only for reconnection signals. */
function dispatchToAll(event: RealtimeEvent): void {
  for (const listeners of hub.subscribers.values()) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        log(`stream write failed: ${String(error)}`);
      }
    }
  }
}

function onNotification(payload: string | undefined): void {
  if (!payload) return;

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payload);
  } catch {
    log("malformed payload (not JSON); skipped");
    return;
  }

  const result = realtimeNotifySchema.safeParse(rawPayload);
  if (!result.success) {
    // Another process may publish to the channel. Do not process an unknown
    // payload, but log it instead of silently ignoring it.
    log(`unknown payload; skipped: ${result.error.issues[0]?.message ?? ""}`);
    return;
  }

  dispatch(result.data.userIds, { kind: result.data.kind });
}

async function connect(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not defined; the realtime stream cannot start.");
  }

  const client = new Client({ connectionString });

  client.on("notification", (message) => {
    if (message.channel !== REALTIME_CHANNEL) return;
    onNotification(message.payload);
  });

  client.on("error", (error) => {
    log(`connection error: ${error.message}`);
    void reconnect();
  });

  await client.connect();
  await client.query(`LISTEN ${REALTIME_CHANNEL}`);

  hub.client = client;
  hub.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  log("listening");
}

async function reconnect(): Promise<void> {
  if (hub.shuttingDown) return;

  const old = hub.client;
  hub.client = null;
  hub.connecting = null;

  if (old) {
    // The connection may already be gone, so ignore close errors.
    await old.end().catch(() => undefined);
  }

  if (hub.subscribers.size === 0) return;

  const delay = hub.reconnectDelay;
  hub.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);

  await new Promise((resolve) => setTimeout(resolve, delay));
  if (hub.shuttingDown || hub.subscribers.size === 0) return;

  try {
    await ensureConnection();
    // Events during the outage may have been missed. A refresh signal is sent
    // to every open stream so missing data is recovered safely.
    dispatchToAll({ kind: REALTIME_EVENTS.reconnected });
  } catch (error) {
    log(`reconnection failed: ${String(error)}`);
    void reconnect();
  }
}

function ensureConnection(): Promise<void> {
  if (hub.client) return Promise.resolve();
  hub.connecting ??= connect().finally(() => {
    hub.connecting = null;
  });
  return hub.connecting;
}

/**
 * Opens a stream for a user. The returned function closes the subscription.
 *
 * The connection closes when there are no subscribers; keeping an unused
 * `LISTEN` connection open would waste a database connection.
 */
export async function subscribe(
  userId: string,
  listener: Listener,
): Promise<() => void> {
  const listeners = hub.subscribers.get(userId) ?? new Set<Listener>();
  listeners.add(listener);
  hub.subscribers.set(userId, listeners);

  try {
    await ensureConnection();
  } catch (error) {
    // Roll back the subscription if the connection cannot be established.
    listeners.delete(listener);
    if (listeners.size === 0) hub.subscribers.delete(userId);
    throw error;
  }

  return () => {
    const currentListeners = hub.subscribers.get(userId);
    if (!currentListeners) return;

    currentListeners.delete(listener);
    if (currentListeners.size === 0) hub.subscribers.delete(userId);

    if (hub.subscribers.size === 0 && hub.client) {
      const client = hub.client;
      hub.client = null;
      void client.end().catch(() => undefined);
      log("no subscribers remain; connection closed");
    }
  };
}

/** Cleanup used by tests and the shutdown signal. */
export async function shutdownRealtimeHub(): Promise<void> {
  hub.shuttingDown = true;
  hub.subscribers.clear();

  const client = hub.client;
  hub.client = null;
  hub.connecting = null;

  if (client) await client.end().catch(() => undefined);
  hub.shuttingDown = false;
  hub.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
}

/** Number of open streams, used by tests. */
export function subscriberCount(): number {
  let total = 0;
  for (const listeners of hub.subscribers.values()) total += listeners.size;
  return total;
}
