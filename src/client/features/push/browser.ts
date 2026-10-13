export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined' &&
    typeof Notification !== 'undefined'
  );
}
export function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('The browser took too long. Please try again.')),
        15_000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
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
export async function clearLocalPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  for (const notification of (await registration?.getNotifications()) ?? [])
    notification.close();
}
