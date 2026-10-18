import { useId, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { Dialog } from '../../ui/Dialog';
import { PersonPhoto } from './EventSummary';
import { guestPhoto } from './EventGuests';
import type { Host } from './types';

const maxHosts = 10;

// Hosts add hosts by email. Whoever signs in with that email and a profile
// photo can accept on the event page, so adding never reveals whether an
// account uses it. The creator always hosts; other hosts can be removed or
// stop hosting.
export function EventHosts({
  id,
  hosts,
  pending,
  onChange,
  onClose,
}: {
  id: string;
  hosts: Host[];
  pending: string[];
  onChange: (left: boolean) => void;
  onClose: () => void;
}) {
  const field = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const full = hosts.length + pending.length >= maxHosts;
  async function run(action: () => Promise<unknown>, left = false) {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await action();
      onChange(left);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }
  function add(submit: FormEvent) {
    submit.preventDefault();
    if (!email.trim()) return;
    void run(async () => {
      await api(`/api/events/${id}/hosts`, jsonRequest('POST', { email }));
      setEmail('');
    });
  }
  return (
    <Dialog title="Hosts" busy={busy} onClose={onClose}>
      <ul className="event-guest-list event-host-list">
        {hosts.map((host) => (
          <li key={host.handle}>
            <PersonPhoto
              name={host.displayName}
              src={guestPhoto(host)}
              size={36}
            />
            <strong>{host.displayName}</strong>
            {!host.isCreator && (
              <button
                type="button"
                className="compact-button"
                aria-label={
                  host.isViewer ? undefined : `Remove ${host.displayName}`
                }
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api(
                        `/api/events/${id}/hosts/${encodeURIComponent(host.handle)}`,
                        { method: 'DELETE' },
                      ),
                    host.isViewer,
                  )
                }
              >
                <span>{host.isViewer ? 'Stop hosting' : 'Remove'}</span>
              </button>
            )}
          </li>
        ))}
        {pending.map((address) => (
          <li key={address}>
            <span className="event-host-pending">
              {address}
              <span className="event-list-meta">Pending</span>
            </span>
            <button
              type="button"
              className="compact-button"
              aria-label={`Remove ${address}`}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(
                    `/api/events/${id}/hosts`,
                    jsonRequest('DELETE', { email: address }),
                  ),
                )
              }
            >
              <span>Remove</span>
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <label htmlFor={field} className="field-label">
          Add a host by email
        </label>
        <input
          id={field}
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          value={email}
          disabled={busy || full}
          onChange={(change) => setEmail(change.target.value)}
        />
        <p className="field-help">
          {full
            ? `An event can have up to ${maxHosts} hosts, including pending ones.`
            : 'Send them the event link too. They can accept when they open it signed in with this email and a profile photo.'}
        </p>
        <button className="primary-button" disabled={busy || full}>
          {busy ? 'Saving…' : 'Add host'}
        </button>
      </form>
      {failure && <p role="alert">{failure}</p>}
    </Dialog>
  );
}
