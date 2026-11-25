self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  event.waitUntil(
    self.registration.showNotification(data.title || 'Videxpulse', {
      body: data.body || 'You have a new notification.',
      icon: '/assets/brand-logo.png',
      data
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.clickUrl || '/';
  event.waitUntil(self.clients.openWindow(targetUrl));
});