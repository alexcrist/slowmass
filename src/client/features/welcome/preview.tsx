// Development-only: exercises the actual welcome screen with synthetic responses.
// Not a production build entry. No API request reaches a Worker or Google.
import { createRoot } from 'react-dom/client';
import { Welcome } from './Welcome';
import '../../styles.css';

const query = new URLSearchParams(location.search);
const flow = query.get('flow') ?? 'normal';
const scenario = query.get('scenario') ?? 'ready';
const dark = query.get('theme') === 'dark';
const token = 'a'.repeat(48);
const hash = flow === 'normal' ? '' : `#${flow}/${token}`;
if (scenario === 'cancelled') {
  query.set('auth', 'google');
  query.set('error', 'signin');
} else {
  query.delete('auth');
  query.delete('error');
}
history.replaceState(null, '', `${location.pathname}?${query}${hash}`);
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const path = new URL(raw, location.origin).pathname;
  if (path === '/api/bootstrap')
    return Response.json({
      signInAvailable: true,
      googleSignInAvailable: scenario !== 'unconfigured',
      user: null,
      profile: null,
    });
  if (path === '/api/invite-link/check')
    return Response.json({ available: scenario !== 'expired' });
  if (path === '/api/event-link')
    return Response.json({
      event:
        scenario === 'expired'
          ? null
          : {
              id: 'synthetic-event',
              open: true,
              preview: {
                title: 'Dinner with friends',
                date: 'Saturday, November 7',
                width: 1200,
                height: 600,
                appearance: {
                  colorTheme: dark ? 'after-hours' : 'original',
                  fontPairing: 'original',
                },
              },
            },
    });
  if (path === '/api/event-link/photo')
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#e5e5e5"/><text x="600" y="300" text-anchor="middle" fill="#555" font-size="36" font-family="sans-serif">Sample event cover</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } },
    );
  if (path === '/api/auth/sign-in/social') {
    if (scenario === 'loading') return new Promise<Response>(() => {});
    return Response.json(
      { message: 'Preview: Google is not contacted.', code: 'PREVIEW' },
      { status: 400 },
    );
  }
  if (path === '/api/auth/sign-in/magic-link')
    return Response.json({ status: true });
  if (path.startsWith('/api/'))
    return Response.json({ error: 'Preview only' }, { status: 404 });
  return originalFetch(input, init);
};

function ReviewControls() {
  function change(key: string, value: string) {
    query.set(key, value);
    location.assign(`${location.pathname}?${query}`);
  }
  return (
    <aside
      style={{
        padding: '12px 20px',
        borderBottom: '1px solid #ccc',
        background: '#fff',
        color: '#171717',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
      }}
      aria-label="Visual review controls"
    >
      <strong>Preview only</strong>
      <label>
        Page{' '}
        <select
          value={flow}
          onChange={(event) => change('flow', event.target.value)}
        >
          <option value="normal">Normal login</option>
          <option value="invite">Member invite</option>
          <option value="event">Event invite</option>
        </select>
      </label>
      <label>
        State{' '}
        <select
          value={scenario}
          onChange={(event) => change('scenario', event.target.value)}
        >
          <option value="ready">Ready / click Google for error</option>
          <option value="loading">Click Google for loading</option>
          <option value="cancelled">Returned from Google</option>
          <option value="expired">Unavailable invitation</option>
          <option value="unconfigured">Google not configured</option>
        </select>
      </label>
      <label>
        Event theme{' '}
        <select
          value={dark ? 'dark' : 'light'}
          onChange={(event) => change('theme', event.target.value)}
        >
          <option value="light">Light</option>
          <option value="dark">After hours</option>
        </select>
      </label>
      <span>
        Email submission previews the email-sent screen. No sign-in or email is
        sent.
      </span>
    </aside>
  );
}
createRoot(document.getElementById('review-controls')!).render(
  <ReviewControls />,
);
createRoot(document.getElementById('root')!).render(<Welcome />);
