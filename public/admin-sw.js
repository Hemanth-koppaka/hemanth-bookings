// Phone alerts (Web Push) for the salon, stylists and waitlisted guests.
// Shows the notification the server sends and opens the page it links to on
// tap. Nothing else: no caching, no network interception. Every alert carries
// its own link, so this public file never names the console's address.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m = { title: "Lumen Studio", body: "Something changed in the diary.", url: "/" };
  try {
    if (event.data) m = { ...m, ...event.data.json() };
  } catch (_) {
    /* keep the default text */
  }
  event.waitUntil(
    self.registration.showNotification(m.title, {
      body: m.body,
      icon: "/icons/app-192.png",
      badge: "/icons/app-badge.png",
      tag: m.tag || undefined,
      renotify: Boolean(m.tag),
      data: { url: m.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  // reuse a window already on the same part of the site (console, stylist, guest)
  const area = "/" + (new URL(url, self.location.origin).pathname.split("/")[1] || "");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (area !== "/" && new URL(c.url).pathname.startsWith(area) && "focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
