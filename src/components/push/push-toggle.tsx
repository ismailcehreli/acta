"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";


type PushStatus =
  | "loading"
  | "unsupported"
  | "not_configured"
  | "blocked"
  | "disabled"
  | "enabled";
function decodeVapidKey(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const t = useTranslations();
  const [status, setStatus] = useState<PushStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (publicKey === null) {
        if (!cancelled) setStatus("not_configured");
        return;
      }

      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("blocked");
        return;
      }

      const record = await navigator.serviceWorker.getRegistration();
      const subscription = await record?.pushManager.getSubscription();
      if (!cancelled) setStatus(subscription ? "enabled" : "disabled");
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function enable() {
    if (publicKey === null) return;
    setWorking(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "disabled");
        return;
      }

      const record = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await record.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) {
        await subscription.unsubscribe();
        setError(t("screens.profile.pushSubscribeFailed"));
        setStatus("disabled");
        return;
      }

      setStatus("enabled");
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? error.message
        : t("screens.profile.pushEnableFailed");
      setError(t("screens.profile.pushOperationFailed", { message: detail }));
    } finally {
      setWorking(false);
    }
  }

  async function disable() {
    setWorking(true);
    setError(null);

    try {
      const record = await navigator.serviceWorker.getRegistration();
      const subscription = await record?.pushManager.getSubscription();
      if (!subscription) {
        setStatus("disabled");
        return;
      }

      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setStatus("disabled");
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? error.message
        : t("screens.profile.pushDisableFailed");
      setError(t("screens.profile.pushOperationFailed", { message: detail }));
    } finally {
      setWorking(false);
    }
  }

  if (status === "loading") {
    return (
      <p className="text-[length:var(--text-sm)] text-muted">
        {t("screens.profile.pushChecking")}
      </p>
    );
  }

  if (status === "not_configured") {
    return (
      <Alert tone="correction">
        {t("screens.profile.pushNotConfigured")}
      </Alert>
    );
  }

  if (status === "unsupported") {
    return (
      <Alert tone="info">
        {t("screens.profile.pushUnsupported")}
      </Alert>
    );
  }

  if (status === "blocked") {
    return (
      <div data-test="push-blocked">
        <Alert tone="correction">{t("screens.profile.pushBlocked")}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-test="push-toggle">
      <p className="text-[length:var(--text-sm)] text-muted">
        {status === "enabled"
          ? t("screens.profile.pushEnabledDescription")
          : t("screens.profile.pushDisabledDescription")}
      </p>

      <div>
        {status === "enabled" ? (
          <Button type="button" onClick={disable} disabled={working}>
            {working
              ? t("screens.profile.pushDisablePending")
              : t("screens.profile.pushDisable")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={enable}
            disabled={working}
          >
            {working
              ? t("screens.profile.pushEnablePending")
              : t("screens.profile.pushEnable")}
          </Button>
        )}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
