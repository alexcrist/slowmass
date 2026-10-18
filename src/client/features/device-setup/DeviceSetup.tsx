import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Dialog } from '../../ui/Dialog';
import { InstallInstructions, useInstallState } from '../install';
import { observeReadActivity } from '../notifications';
import { usePush } from '../push';
import type { Step } from './step';
import type { DeviceSetup } from './useDeviceSetup';

const summaries: Record<Step, string> = {
  'home-screen':
    'To get notifications, first add slowmass to your Home Screen.',
  notifications: 'Turn on notifications for follows and comments.',
  install: 'Install slowmass on this device.',
};
// Dismissing is permanent, matching the follow-back dismiss control's look.
const dismissLabels: Record<Step, string> = {
  'home-screen': 'Dismiss notification suggestion',
  notifications: 'Dismiss notification suggestion',
  install: 'Dismiss install suggestion',
};
export const messages = {
  enabled: 'Notifications are on.',
  installed: 'Installation requested. Look for slowmass on your home screen.',
  installFailed:
    'Could not open the install prompt. Installation instructions are in Settings.',
  declineFailed: 'Could not save your answer. Please try again.',
  unavailable: 'Notifications are temporarily unavailable.',
};

export type RowState = {
  // Null shows only the notice, after the last step completes.
  step: Step | null;
  notice?: string;
  error?: string;
  working?: boolean;
  declining?: boolean;
  // The primary action is waiting for the current notification status.
  waiting?: boolean;
  retry?: boolean;
  unavailable?: boolean;
};

// iPhone/iPad cannot be prompted to install, so Show how explains the steps.
function HomeScreenDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Add slowmass to your Home Screen" onClose={onClose}>
      <p>
        On iPhone and iPad, notifications only work in the Home Screen app.
        Adding it is the first step; you’ll turn notifications on from there.
      </p>
      <InstallInstructions appleMobile forNotifications />
      <p className="install-note">
        Already added it? Open slowmass from your Home Screen.
      </p>
      <div className="dialog-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

// Presentational row shared by the Activity item and the development preview.
// It reuses Activity row classes so it reads as one of the timeline's items.
export function DeviceSetupRow({
  state,
  onPrimary,
  onDecline,
  summaryRef,
}: {
  state: RowState;
  onPrimary?: () => void;
  onDecline?: () => void;
  summaryRef?: Ref<HTMLParagraphElement>;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const { step } = state;
  const busy = state.working || state.declining;
  const label =
    step === 'home-screen'
      ? 'Show how'
      : step === 'install'
        ? state.working
          ? 'Opening…'
          : 'Install'
        : state.working
          ? 'Turning on…'
          : state.retry
            ? 'Retry'
            : 'Turn on';
  return (
    <li>
      <div className="notification-request">
        <div className="notification-person">
          <img
            className="notification-thumbnail"
            src="/icons/app-192.png"
            width={64}
            height={64}
            alt=""
            decoding="async"
          />
          <div className="notification-content">
            {step && <p ref={summaryRef}>{summaries[step]}</p>}
            {state.notice && <p role="status">{state.notice}</p>}
            {state.unavailable && <p>{messages.unavailable}</p>}
            {state.error && <p role="alert">{state.error}</p>}
          </div>
        </div>
        {step && (
          <div className="notification-actions">
            {!state.unavailable && (
              <button
                type="button"
                className="primary-button"
                disabled={busy || state.waiting}
                aria-haspopup={step === 'home-screen' ? 'dialog' : undefined}
                onClick={
                  step === 'home-screen' ? () => setShowSteps(true) : onPrimary
                }
              >
                {label}
              </button>
            )}
            <button
              type="button"
              className="notification-dismiss"
              aria-label={dismissLabels[step]}
              disabled={busy}
              onClick={onDecline}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </div>
      {step === 'home-screen' && showSteps && (
        <HomeScreenDialog onClose={() => setShowSteps(false)} />
      )}
    </li>
  );
}

type StepProps = {
  setup: DeviceSetup;
  step: Step;
  notice: string;
  onNotice: (notice: string) => void;
  summaryRef: Ref<HTMLParagraphElement>;
};
function answer(setup: DeviceSetup) {
  return {
    declining: setup.declining,
    error: setup.declineFailed ? messages.declineFailed : '',
  };
}

export function DeviceSetupItem({ setup }: { setup: DeviceSetup }) {
  const [notice, setNotice] = useState('');
  const summary = useRef<HTMLParagraphElement>(null);
  const { step, unseen, markSeen, refresh } = setup;
  useEffect(() => {
    if (!step || !unseen || !summary.current) return;
    return observeReadActivity(
      new Map([[summary.current, { key: step, version: 0 }]]),
      () => markSeen(step),
    );
  }, [step, unseen, markSeen]);
  const onEnabled = useCallback(() => {
    setNotice(messages.enabled);
    void refresh();
  }, [refresh]);
  // A completed step leaves its status until navigation; dismissal removes the row.
  if (!step)
    return notice && !setup.declined ? (
      <DeviceSetupRow state={{ step, notice }} />
    ) : null;
  const props = {
    setup,
    step,
    notice,
    onNotice: setNotice,
    summaryRef: summary,
  };
  if (step === 'notifications')
    return <NotificationsStep {...props} onEnabled={onEnabled} />;
  if (step === 'install') return <InstallStep {...props} />;
  return <HomeScreenStep {...props} />;
}

function HomeScreenStep({ setup, step, notice, summaryRef }: StepProps) {
  return (
    <DeviceSetupRow
      state={{ step, notice, ...answer(setup) }}
      summaryRef={summaryRef}
      onDecline={() => void setup.decline(step)}
    />
  );
}

function NotificationsStep({
  setup,
  step,
  notice,
  summaryRef,
  onEnabled,
}: StepProps & { onEnabled: () => void }) {
  const push = usePush();
  const requested = useRef(false);
  const { enabled, permission } = push;
  const { decline } = setup;
  useEffect(() => {
    if (enabled) onEnabled();
  }, [enabled, onEnabled]);
  // Blocking the permission prompt opened from this row answers No.
  useEffect(() => {
    if (!requested.current || permission !== 'denied') return;
    requested.current = false;
    void decline(step);
  }, [permission, decline, step]);
  if (enabled)
    return <DeviceSetupRow state={{ step: null, notice: messages.enabled }} />;
  const declined = answer(setup);
  return (
    <DeviceSetupRow
      state={{
        step,
        notice,
        working: push.busy,
        declining: declined.declining,
        waiting: !push.status && !push.error,
        retry: Boolean(push.error),
        unavailable: push.status?.available === false,
        error: declined.error || push.error,
      }}
      summaryRef={summaryRef}
      onPrimary={() => {
        requested.current = true;
        void (push.error ? push.retry() : push.enable());
      }}
      onDecline={() => void decline(step)}
    />
  );
}

function InstallStep({ setup, step, notice, onNotice, summaryRef }: StepProps) {
  const install = useInstallState();
  async function start() {
    // The prompt is consumed immediately, so this row may unmount meanwhile;
    // the answer is recorded through account-level state.
    const outcome = await install?.install();
    if (outcome === 'dismissed') void setup.decline(step);
    else if (outcome === 'accepted') onNotice(messages.installed);
    else if (outcome === 'failed') onNotice(messages.installFailed);
  }
  return (
    <DeviceSetupRow
      state={{ step, notice, working: install?.busy, ...answer(setup) }}
      summaryRef={summaryRef}
      onPrimary={() => void start()}
      onDecline={() => void setup.decline(step)}
    />
  );
}
