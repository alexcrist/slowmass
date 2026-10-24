import { useRef, useState } from 'react';
import { api, jsonRequest } from '../../api';
import {
  isNotificationCategory,
  notificationCategoryLabel,
} from '../../../shared/notification-categories';

// Opened from an email's unsubscribe link, signed in or not. Loading the page
// changes nothing, since mail scanners open links; the button confirms.
export function Unsubscribe({ token }: { token: string }) {
  const category = token.split('.')[1];
  const label = isNotificationCategory(category)
    ? notificationCategoryLabel(category).toLowerCase()
    : 'this kind of activity';
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');
  const running = useRef(false);
  async function confirm() {
    if (running.current) return;
    running.current = true;
    setState('busy');
    setError('');
    try {
      await api('/api/unsubscribe', jsonRequest('POST', { token }));
      setState('done');
    } catch (error) {
      setState('ready');
      setError(
        error instanceof Error ? error.message : 'Could not unsubscribe.',
      );
    } finally {
      running.current = false;
    }
  }
  return (
    <main className="welcome guest-shell">
      <header className="masthead">
        <a className="site-name" href="/" aria-label="slowmass home">
          slowmass
        </a>
      </header>
      <section className="account-section" aria-labelledby="unsubscribe">
        <h1 id="unsubscribe">
          {state === 'done' ? 'Unsubscribed' : 'Stop these emails?'}
        </h1>
        {state === 'done' ? (
          <p role="status">
            You won’t get emails about {label}. Other emails, push alerts, and
            Activity are unchanged.
          </p>
        ) : (
          <>
            <p>
              You’ll stop getting emails about {label}. Other emails, push
              alerts, and Activity stay the same.
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={state === 'busy'}
              onClick={() => void confirm()}
            >
              {state === 'busy' ? 'Unsubscribing…' : 'Unsubscribe'}
            </button>
            {error && <p role="alert">{error}</p>}
          </>
        )}
        <p>
          <a href="/#notification-settings">Notification settings</a>
        </p>
      </section>
    </main>
  );
}
