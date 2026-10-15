import { useCallback, useEffect, useRef, useState } from 'react';
import { api, withDeadline } from '../../api';
import { InstallControls, useInstallState } from '../install';
import { PushControls, usePush } from '../push';

async function setupRequest(method = 'GET') {
  const controller = new AbortController();
  try {
    return await withDeadline(
      api<{ pending: boolean }>('/api/device-setup', {
        method,
        signal: controller.signal,
      }),
    );
  } finally {
    controller.abort();
  }
}

export function useDeviceSetup(initialPending: boolean, ready: boolean) {
  const [pending, setPending] = useState(initialPending);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const dismissed = useRef(false);
  const inFlight = useRef(false);
  const save = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await setupRequest('DELETE');
    } catch {
      if (mounted.current)
        setError(
          'Your setup choice could not be saved. You can keep using slowmass, or retry to remember it.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }, []);
  const complete = useCallback(() => {
    dismissed.current = true;
    setPending(false);
    void save();
  }, [save]);
  useEffect(() => {
    mounted.current = true;
    let reading = false;
    let disposed = false;
    const check = async () => {
      if (
        !ready ||
        !pending ||
        dismissed.current ||
        reading ||
        document.visibilityState === 'hidden'
      )
        return;
      reading = true;
      try {
        const result = await setupRequest();
        if (!disposed && !dismissed.current && !result.pending)
          setPending(false);
      } catch {
        /* A failed optional read never blocks access or implies completion. */
      } finally {
        reading = false;
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      mounted.current = false;
      disposed = true;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pending, ready]);
  return { pending, complete, error, saving, retry: save };
}

export function DeviceSetup({ onContinue }: { onContinue: () => void }) {
  const install = useInstallState();
  const push = usePush();
  const resolved =
    (!install?.mobile || install.installed) &&
    !push.busy &&
    !push.error &&
    (push.enabled || (!push.supported && !push.needsHomeScreen));
  useEffect(() => {
    if (resolved) onContinue();
  }, [resolved, onContinue]);
  return (
    <>
      <p className="onboarding-intro">
        These options are optional. You can change them later in Settings.
      </p>
      {install?.mobile && !install.running && (
        <section
          className="device-setup-option"
          aria-labelledby="setup-install"
        >
          <h2 id="setup-install">Install slowmass</h2>
          <InstallControls />
        </section>
      )}
      <section
        className="device-setup-option"
        aria-labelledby="setup-notifications"
      >
        <h2 id="setup-notifications">Notifications</h2>
        <PushControls push={push} />
      </section>
      <button
        type="button"
        className="primary-button device-setup-continue"
        onClick={onContinue}
      >
        Continue
      </button>
    </>
  );
}
