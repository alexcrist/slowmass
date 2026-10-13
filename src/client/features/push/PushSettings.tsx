import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useInstallState } from '../install';
import {
  applicationKey,
  clearLocalPush,
  pushSupported,
  withDeadline,
} from './browser';

type Status = {
  available: boolean;
  publicKey: string | null;
  subscription: { id: string; endpoint: string } | null;
};
export function PushSettings() {
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const install = useInstallState();
  const needsHomeScreen = Boolean(install?.appleMobile && !install.installed);
  const supported = pushSupported();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    status: Status;
    enabled: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
  );
  useEffect(() => {
    if (!supported || needsHomeScreen) return;
    const controller = new AbortController();
    const current = ++generation.current;
    let disposed = false;
    const timeout = setTimeout(() => {
      controller.abort();
      if (!disposed && current === generation.current)
        setError('Could not check push settings. Please retry.');
    }, 15_000);
    Promise.all([
      api<Status>('/api/push', { signal: controller.signal }),
      withDeadline(
        navigator.serviceWorker
          .getRegistration('/')
          .then((registration) => registration?.pushManager.getSubscription()),
      ),
    ])
      .then(([status, subscription]) => {
        if (!controller.signal.aborted && current === generation.current) {
          setPermission(Notification.permission);
          setState({
            status,
            enabled:
              Notification.permission === 'granted' &&
              Boolean(
                subscription &&
                status.subscription?.endpoint === subscription.endpoint,
              ),
          });
          setError('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && current === generation.current)
          setError('Could not check push settings. Please retry.');
      })
      .finally(() => clearTimeout(timeout));
    const expired = () => setPermission(Notification.permission);
    window.addEventListener('focus', expired);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
      window.removeEventListener('focus', expired);
    };
  }, [attempt, supported, needsHomeScreen]);
  async function enable() {
    if (busy || !state?.status.publicKey) return;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      // Ask synchronously within the click gesture, before registration/network awaits.
      const granted = await Notification.requestPermission();
      if (!mounted.current) return;
      setPermission(granted);
      if (granted !== 'granted') return;
      await withDeadline(
        navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        }),
      );
      const registration = await withDeadline(navigator.serviceWorker.ready);
      let subscription = await withDeadline(
        registration.pushManager.getSubscription(),
      );
      if (
        subscription &&
        subscription.endpoint !== state.status.subscription?.endpoint
      ) {
        // Do not attach a previous signed-in account's subscription to this one.
        await withDeadline(subscription.unsubscribe());
        subscription = null;
      }
      subscription ??= await withDeadline(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(state.status.publicKey),
        }),
      );
      if (!mounted.current) return;
      await withDeadline(
        api('/api/push', {
          method: 'PUT',
          body: JSON.stringify(subscription.toJSON()),
        }),
      );
      setState({ ...state, enabled: true });
      setAttempt((value) => value + 1);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not enable notifications. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    if (busy) return;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      await withDeadline(api('/api/push', { method: 'DELETE' }));
      setState((current) =>
        current
          ? {
              status: { ...current.status, subscription: null },
              enabled: false,
            }
          : current,
      );
      // Server revocation is authoritative, even if browser cleanup fails.
      await withDeadline(clearLocalPush()).catch(() => {});
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not disable notifications. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="settings-disclosure">
      <summary className="settings-row">Push notifications</summary>
      <div className="settings-details">
        <p>
          Get alerts when invitees join, for follow requests, new followers,
          comments, and likes on this device. Open an alert to view it in
          Activity.
        </p>
        {needsHomeScreen ? (
          <p>
            On iPhone or iPad, add slowmass to your Home Screen first, open the
            slowmass icon, then return to Settings to enable notifications.
          </p>
        ) : !supported ? (
          <p>Push notifications aren’t supported in this browser.</p>
        ) : (
          <>
            {!state && !error && <p role="status">Checking push settings…</p>}
            {permission === 'denied' && (
              <p>
                Notifications are blocked. Allow notifications for slowmass in
                your browser or device settings, then return here.
              </p>
            )}
            {state && !state.status.available && (
              <p>Push notifications are temporarily unavailable.</p>
            )}
            {state && (
              <>
                <p role="status">
                  {state.enabled && permission === 'granted'
                    ? 'Notifications are on for this device.'
                    : 'Notifications are off for this device.'}
                </p>
                {state.status.subscription || state.enabled ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disable()}
                  >
                    {busy ? 'Updating…' : 'Disable notifications'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      busy || !state.status.available || permission === 'denied'
                    }
                    onClick={() => void enable()}
                  >
                    {busy ? 'Enabling…' : 'Enable notifications'}
                  </button>
                )}
              </>
            )}
            <p>
              Alerts don’t include names, comment text, or photos. Signing out
              turns them off for this browser.
            </p>
          </>
        )}
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </>
        )}
      </div>
    </details>
  );
}
