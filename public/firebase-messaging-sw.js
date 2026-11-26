/* ShipWell Admin: background push notifications (admin.shipwell.cc only). */
importScripts("https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js");

firebase.initializeApp({
  "apiKey": "AIzaSyCbjvHMlLzIRodlePRd8BmXg0-r1obu0Ew",
  "authDomain": "shipwell-prod.firebaseapp.com",
  "projectId": "shipwell-prod",
  "storageBucket": "shipwell-prod.firebasestorage.app",
  "messagingSenderId": "277888162591",
  "appId": "1:277888162591:web:4112f1f0a2f0301033ae2a"
});
const messaging = firebase.messaging();

// Server sends data-only messages so we control the look and the click target.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || "ShipWell Admin", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/favicon-32.png",
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || "/" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(target).catch(() => null);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
