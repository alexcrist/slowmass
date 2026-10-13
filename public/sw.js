// Push only. No fetch handler, private response cache, or offline content.
self.addEventListener('install', (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener('push', (event) => {
  let data = {};
  try {
    const payload = event.data?.json();
    if (payload && typeof payload === 'object') data = payload;
  } catch {
    /* Still show a generic alert. */
  }
  const key =
    typeof data.key === 'string' &&
    /^(request|follower|joined|likes|comment):[a-zA-Z0-9-]{1,64}$/.test(
      data.key,
    )
      ? data.key
      : '';
  const version =
    Number.isSafeInteger(data.version) && data.version > 0 ? data.version : 0;
  const subscription =
    typeof data.subscriptionId === 'string' ? data.subscriptionId : '';
  event.waitUntil(
    self.registration.showNotification('slowmass', {
      body: 'You have new activity. Open slowmass to see it.',
      icon: '/icons/app-192.png',
      tag: `slowmass:${subscription}:${key}`,
      data: { key, version },
      renotify: false,
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const key = event.notification.data?.key;
  const path =
    typeof key === 'string' &&
    /^(request|follower|joined|likes|comment):[a-zA-Z0-9-]{1,64}$/.test(key)
      ? `/#notifications/${key}`
      : '/#notifications';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const navigated = await client.navigate(url);
          if (navigated) {
            await navigated.focus();
            return;
          }
        } catch {
          /* A window may have closed since matchAll. Open a new one. */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
