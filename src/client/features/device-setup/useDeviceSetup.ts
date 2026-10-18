import { useCallback, useEffect, useRef, useState } from 'react';
import { api, withDeadline } from '../../api';
import { useInstallState } from '../install';
import { localPushState } from '../push';
import { deviceSetupStep, steps, type PushState, type Step } from './step';

// Which steps this browser has shown for 250 ms. It is a presentation hint for
// the badge, not consent or private data. iPhone browser tabs and Home Screen
// apps have separate storage, so the app counts its own notifications step.
const seenKey = 'slowmass:device-setup-seen';
function readSeen(): Step[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(seenKey) ?? '[]');
    return Array.isArray(value)
      ? steps.filter((step) => value.includes(step))
      : [];
  } catch {
    return [];
  }
}

export type DeviceSetup = ReturnType<typeof useDeviceSetup>;
export function useDeviceSetup(
  initial: { pending: boolean; pushSubscribed: boolean },
  ready: boolean,
) {
  const install = useInstallState();
  const [pending, setPending] = useState(initial.pending);
  const [push, setPush] = useState<PushState>('unknown');
  const [seen, setSeen] = useState(readSeen);
  // Keep the answered row visible while No is saving or after it fails, even if
  // the browser consumed its install prompt meanwhile.
  const [declined, setDeclined] = useState<{
    step: Step;
    saving: boolean;
  } | null>(null);
  const generation = useRef(0);
  const mobile = Boolean(install?.mobile);
  const appleMobile = Boolean(install?.appleMobile);
  const running = Boolean(install?.running);
  const checksPush = ready && pending && mobile && (!appleMobile || running);
  const refresh = useCallback(async () => {
    if (!checksPush || document.visibilityState === 'hidden') return;
    const current = ++generation.current;
    const state = await withDeadline(localPushState()).catch(
      () => 'unknown' as const,
    );
    if (current === generation.current) setPush(state);
  }, [checksPush]);
  useEffect(() => {
    if (!checksPush) return;
    void refresh();
    const returned = () => void refresh();
    window.addEventListener('focus', returned);
    window.addEventListener('hashchange', returned);
    document.addEventListener('visibilitychange', returned);
    return () => {
      generation.current++;
      window.removeEventListener('focus', returned);
      window.removeEventListener('hashchange', returned);
      document.removeEventListener('visibilitychange', returned);
    };
  }, [checksPush, refresh]);
  const step = ready
    ? (declined?.step ??
      deviceSetupStep({
        pending,
        pushSubscribed: initial.pushSubscribed,
        mobile,
        appleMobile,
        running,
        installPrompt: Boolean(install?.prompt),
        push,
      }))
    : null;
  const markSeen = useCallback(
    (value: Step) => {
      if (seen.includes(value)) return;
      const next = [...seen, value];
      setSeen(next);
      try {
        localStorage.setItem(seenKey, JSON.stringify(next));
      } catch {
        /* Without storage, seen state lasts for this page load. */
      }
    },
    [seen],
  );
  const saving = Boolean(declined?.saving);
  // No is permanent for the account and every device.
  const decline = useCallback(
    async (value: Step) => {
      if (saving) return;
      setDeclined({ step: value, saving: true });
      const controller = new AbortController();
      try {
        await withDeadline(
          api('/api/device-setup', {
            method: 'DELETE',
            signal: controller.signal,
          }),
          controller.signal,
        );
        setPending(false);
        setDeclined(null);
      } catch {
        controller.abort();
        setDeclined({ step: value, saving: false });
      }
    },
    [saving],
  );
  return {
    step,
    unseen: Boolean(step && !declined && !seen.includes(step)),
    markSeen,
    decline,
    declined: !pending,
    declining: saving,
    declineFailed: Boolean(declined && !saving),
    refresh,
  };
}
