import type { PrismaClient } from "@prisma/client";

import {
  notificationChannelKey,
  notificationEnabledKey,
} from "@/server/settings/registry";
import { readSettingValue } from "@/server/settings/system-settings";

import {
  NOTIFICATION_EVENT_DETAILS,
  type NotificationDeliveryChannel,
  type NotificationEvent,
} from "./events";

export type NotificationPolicyDb = Pick<PrismaClient, "systemSetting">;

export interface NotificationPolicy {
  enabled: boolean;
  channel: NotificationDeliveryChannel;
  email: boolean;
  push: boolean;
}

function channelAllowsEmail(channel: NotificationDeliveryChannel): boolean {
  return channel === "EMAIL" || channel === "BOTH";
}

function channelAllowsPush(channel: NotificationDeliveryChannel): boolean {
  return channel === "PUSH" || channel === "BOTH";
}

/** Bir olayın geçerli varsayılan ayarını döndürür. */
export function defaultNotificationPolicy(
  event: NotificationEvent,
): NotificationPolicy {
  const channel = NOTIFICATION_EVENT_DETAILS[event].defaultChannel;
  return {
    enabled: true,
    channel,
    email: channelAllowsEmail(channel),
    push: channelAllowsPush(channel),
  };
}

/**
 * Sistem genelindeki olay ayarını okur. Kapatılamayan olaylar için veritabanı
 * yanlışlıkla `false` içerse bile bildirim açık kalır.
 */
export async function readNotificationPolicy(
  db: NotificationPolicyDb,
  event: NotificationEvent,
): Promise<NotificationPolicy> {
  const fallback = defaultNotificationPolicy(event);
  const details = NOTIFICATION_EVENT_DETAILS[event];
  const channelValue = await readSettingValue(db, notificationChannelKey(event));
  const parsedChannel = (
    channelValue === "EMAIL" || channelValue === "PUSH" || channelValue === "BOTH"
      ? channelValue
      : fallback.channel
  ) as NotificationDeliveryChannel;
  // Parola bağlantısı taşıyan olaylar tarayıcı bildirimiyle sınırlanamaz.
  // Yönetim ekranı bunu zaten kaydetmez; bu ek koruma eski ya da elle yazılmış
  // bir ayarın kullanıcıyı bağlantısız bırakmasını önler.
  const channel =
    !details.canDisable && parsedChannel === "PUSH"
      ? fallback.channel
      : parsedChannel;

  const enabled = details.canDisable
    ? (await readSettingValue(db, notificationEnabledKey(event))) === "true"
    : true;

  return {
    enabled,
    channel,
    email: enabled && channelAllowsEmail(channel),
    push: enabled && channelAllowsPush(channel),
  };
}
