// Push service worker (Task 5.3b).
//
// There is **no business logic here**: the worker shows an incoming
// notification and opens its target when clicked. A service worker runs
// independently of the page, so placing business rules here would put them in
// one of the hardest browser surfaces to update.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Show a visible but harmless notification instead of silently swallowing
    // an unexpected payload.
    payload = { title: "Activity Reporting", body: "You have a new notification.", url: "/" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Activity Reporting", {
      body: payload.body ?? "",
      // Use the URL as the notification tag: a second notification for the
      // same record replaces the first instead of growing the notification pile.
      tag: payload.url ?? "/",
      data: { url: payload.url ?? "/" },
      icon: "/api/branding/logo",
      badge: "/api/branding/logo",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/";

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Do not open a new tab when the target is already open; opening one on
      // every click quickly creates clutter.
      for (const windowClient of windowClients) {
        if (windowClient.url === targetUrl && "focus" in windowClient) {
          return windowClient.focus();
        }
      }

      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })(),
  );
});
