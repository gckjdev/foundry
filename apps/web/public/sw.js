self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Foundry", body: "" };
  event.waitUntil(
    self.registration.showNotification(data.title || "Foundry", {
      body: data.body,
      data: { url: data.url },
      tag: data.url,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (url) event.waitUntil(self.clients.openWindow(url));
});
