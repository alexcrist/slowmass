import { useCallback, useEffect, useRef, useState } from 'react';
import { api, withDeadline } from '../../api';
import { useInstallState } from '../install';
import { applicationKey, clearLocalPush, pushSupported } from './browser';

type Status = {
  available: boolean;
  publicKey: string | null;
  subscription: { id: string; endpoint: string } | null;
};
async function request<T>(controller: AbortController, options?: RequestInit) {
  try {
    return await withDeadline(
      api<T>('/api/push/device', { ...options, signal: controller.signal }),
      controller.signal,
    );
  } catch (error) {
    controller.abort();
    throw error;
  }
}
function endpointHeaders(endpoint?: string) {
  return endpoint ? { 'X-Push-Endpoint': endpoint } : undefined;
}

export function usePush() {
  const install = useInstallState();
  const needsHomeScreen = Boolean(install?.appleMobile && !install.running);
  const supported = pushSupported();
  const mounted = useRef(false);
  const generation = useRef(0);
  const working = useRef(false);
  const network = useRef<AbortController | null>(null);
  // Only reuse an unregistered subscription created by this mounted account's
  // explicit opt-in. A subscription left by another account is never adopted.
  const pending = useRef<PushSubscription | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<
    'check' | 'enable' | 'disable'
  >('check');
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
  );
  const check = useCallback(async () => {
    if (!supported || needsHomeScreen || working.current) return;
    const current = ++generation.current;
    network.current?.abort();
    const controller = new AbortController();
    network.current = controller;
    try {
      const registration = await withDeadline(
        navigator.serviceWorker.getRegistration('/'),
      );
      const subscription = await withDeadline(
        Promise.resolve(registration?.pushManager.getSubscription()),
      );
      if (!mounted.current || current !== generation.current) return;
      const value = await request<Status>(controller, {
        headers: endpointHeaders(subscription?.endpoint),
      });
      if (!mounted.current || current !== generation.current) return;
      setStatus(value);
      setPermission(Notification.permission);
      setEnabled(
        Notification.permission === 'granted' &&
          Boolean(
            subscription &&
            value.subscription?.endpoint === subscription.endpoint,
          ),
      );
      setError('');
    } catch {
      if (mounted.current && current === generation.current) {
        setError('Could not check push settings. Please retry.');
        setFailedAction('check');
      }
    }
  }, [supported, needsHomeScreen]);
  useEffect(() => {
    mounted.current = true;
    void check();
    const returned = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      )
        return;
      void check();
    };
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    window.addEventListener('online', returned);
    return () => {
      mounted.current = false;
      generation.current++;
      network.current?.abort();
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', returned);
      window.removeEventListener('online', returned);
    };
  }, [check]);

  async function enable() {
    if (working.current || !status?.publicKey || needsHomeScreen || !supported)
      return;
    working.current = true;
    const current = ++generation.current;
    network.current?.abort();
    const controller = new AbortController();
    network.current = controller;
    const active = () => mounted.current && current === generation.current;
    setBusy(true);
    setError('');
    setFailedAction('enable');
    try {
      // Invoke from the user's click, before any network or service-worker await.
      const granted =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
      if (!active()) return;
      setPermission(granted);
      if (granted !== 'granted') {
        setEnabled(false);
        return;
      }
      await withDeadline(
        navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        }),
      );
      if (!active()) return;
      const registration = await withDeadline(navigator.serviceWorker.ready);
      if (!active()) return;
      let subscription = await withDeadline(
        registration.pushManager.getSubscription(),
      );
      if (!active()) return;
      if (
        subscription &&
        subscription.endpoint !== status.subscription?.endpoint &&
        subscription.endpoint !== pending.current?.endpoint
      ) {
        if (!(await withDeadline(subscription.unsubscribe())))
          throw new Error('Could not reset notifications. Please retry.');
        subscription = null;
      }
      if (!active()) return;
      subscription ??= await withDeadline(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(status.publicKey),
        }),
      );
      if (!active()) return;
      pending.current = subscription;
      await request(controller, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!active()) return;
      setEnabled(true);
      // Read back the server-issued identity; never fabricate enabled ownership.
      const value = await request<Status>(controller, {
        headers: endpointHeaders(subscription.endpoint),
      });
      if (!active()) return;
      setStatus(value);
      setEnabled(
        Boolean(value.subscription?.endpoint === subscription.endpoint),
      );
      if (!value.subscription)
        throw new Error('Could not confirm notifications. Please retry.');
      pending.current = null;
    } catch (error) {
      if (active())
        setError(
          error instanceof Error
            ? error.message
            : 'Could not enable notifications. Please retry.',
        );
    } finally {
      working.current = false;
      if (active()) setBusy(false);
    }
  }
  async function disable() {
    if (working.current || !status?.subscription) return;
    working.current = true;
    const current = ++generation.current;
    network.current?.abort();
    const controller = new AbortController();
    network.current = controller;
    const active = () => mounted.current && current === generation.current;
    setBusy(true);
    setError('');
    setFailedAction('disable');
    try {
      await request(controller, {
        method: 'DELETE',
        headers: endpointHeaders(status.subscription.endpoint),
      });
      if (!active()) return;
      pending.current = null;
      setEnabled(false);
      setStatus({ ...status, subscription: null });
      // Authenticated server revocation precedes best-effort browser cleanup.
      await withDeadline(clearLocalPush(status.subscription.endpoint)).catch(
        () => {},
      );
    } catch (error) {
      if (active())
        setError(
          error instanceof Error
            ? error.message
            : 'Could not disable notifications. Please retry.',
        );
    } finally {
      working.current = false;
      if (active()) setBusy(false);
    }
  }
  return {
    needsHomeScreen,
    supported,
    status,
    enabled,
    busy,
    error,
    permission,
    enable,
    disable,
    retry:
      failedAction === 'enable'
        ? enable
        : failedAction === 'disable'
          ? disable
          : check,
  };
}
