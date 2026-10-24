// Development-only preview of every device-setup row. Served by `npm run dev:ui`
// at /previews/device-setup.html; the production build includes only index.html.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles.css';
import { DeviceSetupRow, messages, type RowState } from './DeviceSetup';
import { deviceSetupStep, type DeviceFacts } from './step';

const base: DeviceFacts = {
  pending: true,
  pushSubscribed: false,
  mobile: true,
  appleMobile: false,
  running: false,
  installPrompt: false,
  push: 'off',
};
const apple = { ...base, appleMobile: true };
const devices: { title: string; facts: DeviceFacts }[] = [
  { title: 'iPhone/iPad browser', facts: apple },
  {
    title: 'iPhone/iPad browser, notifications on another device',
    facts: { ...apple, pushSubscribed: true },
  },
  {
    title: 'iPhone/iPad Home Screen app, notifications off',
    facts: { ...apple, running: true },
  },
  {
    title: 'iPhone/iPad Home Screen app, notifications on',
    facts: { ...apple, running: true, push: 'on' },
  },
  {
    title: 'iPhone/iPad Home Screen app, notifications blocked',
    facts: { ...apple, running: true, push: 'denied' },
  },
  {
    title: 'Android browser, notifications off, install available',
    facts: { ...base, installPrompt: true },
  },
  {
    title: 'Android browser, notifications on, install available',
    facts: { ...base, push: 'on', installPrompt: true },
  },
  {
    title: 'Android browser, notifications blocked, install available',
    facts: { ...base, push: 'denied', installPrompt: true },
  },
  {
    title: 'Android, notifications on, already installed',
    facts: { ...base, push: 'on' },
  },
  {
    title: 'Android installed app, notifications off',
    facts: { ...base, running: true },
  },
  { title: 'Member answered No', facts: { ...base, pending: false } },
  { title: 'Desktop', facts: { ...base, mobile: false } },
];
const states: { title: string; state: RowState }[] = [
  {
    title: 'Checking notification status',
    state: { step: 'notifications', waiting: true },
  },
  {
    title: 'Turning on notifications',
    state: { step: 'notifications', working: true },
  },
  {
    title: 'Turning on failed',
    state: {
      step: 'notifications',
      retry: true,
      error: 'Could not enable notifications. Please retry.',
    },
  },
  {
    title: 'Notifications unavailable on the server',
    state: { step: 'notifications', unavailable: true },
  },
  {
    title: 'Notifications turned on, nothing left (iPhone/iPad)',
    state: { step: null, notice: messages.enabled },
  },
  {
    title: 'Android after turning on notifications',
    state: { step: 'install', notice: messages.enabled },
  },
  {
    title: 'Opening the install prompt',
    state: { step: 'install', working: true },
  },
  {
    title: 'Installation requested',
    state: { step: null, notice: messages.installed },
  },
  {
    title: 'Install prompt failed',
    state: { step: null, notice: messages.installFailed },
  },
  {
    title: 'Saving dismissal',
    state: { step: 'notifications', declining: true },
  },
  {
    title: 'Dismissal failed to save',
    state: { step: 'notifications', error: messages.declineFailed },
  },
];
const placeholder =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d6d6d6"/></svg>',
  );

// Static copies of real Activity rows, for side-by-side comparison only.
function SampleRows() {
  return (
    <>
      <li>
        <div className="notification-request">
          <a className="notification-person" href="#preview">
            <img
              className="notification-avatar"
              src={placeholder}
              width={64}
              height={64}
              alt=""
            />
            <div className="notification-content">
              <p>friend started following you.</p>
              <time>10/17/2026, 9:41:00 AM</time>
            </div>
          </a>
          <div className="notification-actions">
            <button className="primary-button">Follow back</button>
            <button
              className="notification-dismiss"
              aria-label="Dismiss follow back for friend"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      </li>
      <li>
        <a className="notification-post" href="#preview">
          <img
            className="notification-thumbnail"
            src={placeholder}
            width={64}
            height={64}
            alt=""
          />
          <div className="notification-content">
            <p>2 people like your photo.</p>
            <time>10/17/2026, 9:12:00 AM</time>
          </div>
        </a>
      </li>
    </>
  );
}

function Frame({
  title,
  detail,
  state,
}: {
  title: string;
  detail: string;
  state: RowState | null;
}) {
  return (
    <section className="preview-frame" aria-label={title}>
      <h3>{title}</h3>
      <p className="status-copy">{detail}</p>
      <div className="preview-screen">
        <ul className="notification-list">
          {state ? (
            <DeviceSetupRow state={state} />
          ) : (
            <li className="preview-empty">No device-setup row.</li>
          )}
          <SampleRows />
        </ul>
      </div>
    </section>
  );
}

function Preview() {
  const [width, setWidth] = useState(390);
  return (
    <main className="preview" style={{ ['--frame' as string]: `${width}px` }}>
      <h1>Device setup preview</h1>
      <p className="status-copy">
        Development only. Rows use the app stylesheet; sample Activity rows
        below each one are static copies. Only “Show how” responds: it opens the
        real iPhone/iPad dialog.
      </p>
      <label>
        Phone width{' '}
        <select
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
        >
          {[320, 360, 390, 430].map((value) => (
            <option key={value} value={value}>
              {value}px
            </option>
          ))}
        </select>
      </label>
      <h2>What each device shows</h2>
      <div className="preview-grid">
        {devices.map(({ title, facts }) => {
          const step = deviceSetupStep(facts);
          return (
            <Frame
              key={title}
              title={title}
              detail={
                step
                  ? 'Adds 1 to the Activity badge until seen on this device.'
                  : 'Nothing shown; no badge.'
              }
              state={step ? { step } : null}
            />
          );
        })}
      </div>
      <h2>Row states</h2>
      <div className="preview-grid">
        {states.map(({ title, state }) => (
          <Frame
            key={title}
            title={title}
            detail={state.step ? 'Actions shown.' : 'Status only.'}
            state={state}
          />
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
