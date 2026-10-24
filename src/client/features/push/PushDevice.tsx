import { InstallInstructions } from '../install';
import { usePush } from './usePush';

function PushControls({ push }: { push: ReturnType<typeof usePush> }) {
  const {
    needsHomeScreen,
    supported,
    status,
    enabled,
    busy,
    error,
    permission,
    enable,
    disable,
    retry,
  } = push;
  return (
    <>
      {needsHomeScreen ? (
        <>
          <p>
            On iPhone and iPad, push alerts only work in the slowmass Home
            Screen app:
          </p>
          <InstallInstructions appleMobile notificationsFrom="settings" />
        </>
      ) : !supported ? (
        <p>
          Push notifications aren’t supported in this browser. You can still see
          activity in slowmass.
        </p>
      ) : (
        <>
          {!status && !error && <p role="status">Checking push settings…</p>}
          {permission === 'denied' && (
            <p>
              Notifications are blocked. Allow notifications for slowmass in
              your browser or device settings, then return here.
            </p>
          )}
          {status && !status.available && (
            <p>Push notifications are temporarily unavailable.</p>
          )}
          {status && !error && (
            <p role="status">
              {enabled && permission === 'granted'
                ? 'Notifications are on for this browser or app.'
                : 'Notifications are off for this browser or app.'}
            </p>
          )}
          {status && !error && (
            <>
              {enabled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disable()}
                >
                  {busy ? 'Updating…' : 'Disable notifications'}
                </button>
              ) : (
                status.available &&
                permission !== 'denied' && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void enable()}
                  >
                    {busy ? 'Enabling…' : 'Enable notifications'}
                  </button>
                )
              )}
              {!enabled && status.subscription && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disable()}
                >
                  Disable notifications
                </button>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" disabled={busy} onClick={() => void retry()}>
            Retry
          </button>
        </>
      )}
    </>
  );
}
// This device's push status, with the steps to turn alerts on.
export function PushDevice() {
  return <PushControls push={usePush()} />;
}
