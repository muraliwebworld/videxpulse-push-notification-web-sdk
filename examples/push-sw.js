self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const notif = payload.notification || payload;
  const title = notif.title || payload.title || 'Videxpulse';
  const body = notif.body || payload.body || 'You have a new notification.';
  const icon = notif.icon || notif.image || payload.imageUrl || '/assets/brand-logo.png';
  const clickUrl = payload.fcmOptions?.link || notif.click_action || payload.data?.clickUrl || payload.clickUrl || '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      data: { ...payload, clickUrl }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.clickUrl || '/';
  event.waitUntil(self.clients.openWindow(targetUrl));
});