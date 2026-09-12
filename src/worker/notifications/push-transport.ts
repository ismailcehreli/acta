import webpush from "web-push";

import type { PushEndpoint, PushMessage, PushSendOutcome, PushTransport } from "./push";

const PERMANENT_ERRORS = new Set([404, 410]);

export const webPushTransport: PushTransport = {
  async send(
    endpoint: PushEndpoint,
    message: PushMessage,
    keys,
  ): Promise<PushSendOutcome> {
    try {
      await webpush.sendNotification(
        {
          endpoint: endpoint.endpoint,
          keys: { p256dh: endpoint.p256dh, auth: endpoint.auth },
        },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: keys.subject,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: 60 * 60 * 24,
        },
      );

      return { ok: true };
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode: unknown }).statusCode)
          : 0;

      if (PERMANENT_ERRORS.has(statusCode)) return { ok: false, gone: true };

      return {
        ok: false,
        gone: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
