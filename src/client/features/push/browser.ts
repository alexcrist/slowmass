export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined' &&
    typeof Notification !== 'undefined'
  );
}
export function applicationKey(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (char) => char.charCodeAt(0),
  );
}
export async function dismissPushNotifications(
  items: { key: string; version: number }[],
) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.getNotifications) return;
  for (const notification of await registration.getNotifications()) {
    if (
      items.some(
        (item) =>
          notification.data?.key === item.key &&
          notification.data?.version <= item.version,
      )
    )
      notification.close();
  }
}
export async function clearLocalPush(expectedEndpoint?: string) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (expectedEndpoint && subscription?.endpoint !== expectedEndpoint) return;
  await subscription?.unsubscribe();
  for (const notification of (await registration?.getNotifications()) ?? [])
    notification.close();
}

// Answer only a same-origin service worker's window-mode probe. No account data
// or persistent client identifiers are exchanged.
export function observePushWindow() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'slowmass:window-mode' || !event.ports[0]) return;
    event.ports[0].postMessage({
      standalone:
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    event.ports[0].close();
  });
}
