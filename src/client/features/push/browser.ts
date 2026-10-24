import { api } from '../../api';
export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined' &&
    typeof Notification !== 'undefined'
  );
}
// Endpoints the server confirmed during this page load, so navigation
// doesn't repeat the check. A confirmed subscription that later stops working
// is noticed on the next load.
const confirmed = new Set<string>();

// This device's state for choosing a suggestion. A local subscription counts as
// on only once the server confirms it delivers to this endpoint for the current
// login: the browser may have renewed the endpoint, or the login it was
// registered under may have expired. A failed check counts as on, so being
// offline never suggests turning notifications on. usePush remains
// authoritative for Settings and opt-in.
export async function devicePushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const registration = await navigator.serviceWorker.getRegistration('/');
  const endpoint = (await registration?.pushManager.getSubscription())
    ?.endpoint;
  if (!endpoint) return 'off';
  if (confirmed.has(endpoint)) return 'on';
  try {
    const status = await api<{
      available: boolean;
      subscription: { endpoint: string } | null;
    }>('/api/push/device', { headers: { 'X-Push-Endpoint': endpoint } });
    if (!status.available || status.subscription?.endpoint === endpoint) {
      confirmed.add(endpoint);
      return 'on';
    }
    return 'off';
  } catch {
    return 'on';
  }
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
