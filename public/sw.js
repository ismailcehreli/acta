// Push service worker (Görev 5.3b).
//
// Burada **hiç uygulama mantığı yoktur**: gelen bildirimi gösterir ve
// tıklandığında ilgili sayfayı açar. Service worker sayfadan bağımsız çalışır;
// içine iş kuralı koymak, tarayıcıda güncellenmesi en zor yere kural koymak
// olurdu.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let veri;
  try {
    veri = event.data.json();
  } catch {
    // Beklenmeyen biçimde bir gövde geldiyse sessizce yutmak yerine görünür
    // ama zararsız bir bildirim gösterilir.
    veri = { title: "Faaliyet Raporlama", body: "Yeni bir bildiriminiz var.", url: "/" };
  }

  event.waitUntil(
    self.registration.showNotification(veri.title ?? "Faaliyet Raporlama", {
      body: veri.body ?? "",
      // Adres etiket olarak kullanılır: aynı kayda ait ikinci bildirim
      // birincinin üstüne yazar, bildirim yığını şişmez.
      tag: veri.url ?? "/",
      data: { url: veri.url ?? "/" },
      icon: "/api/branding/logo",
      badge: "/api/branding/logo",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const hedef = event.notification.data?.url ?? "/";

  event.waitUntil(
    (async () => {
      const pencereler = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Açık sekme varsa yenisi açılmaz; her tıklamada yeni pencere açmak
      // hızla kirlilik üretiyor.
      for (const pencere of pencereler) {
        if (pencere.url === hedef && "focus" in pencere) return pencere.focus();
      }

      if (self.clients.openWindow) return self.clients.openWindow(hedef);
      return undefined;
    })(),
  );
});
