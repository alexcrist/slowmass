import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { Dialog } from '../../ui/Dialog';
import { PersonPhoto } from './EventSummary';
import { guestPhoto } from './EventGuests';
import type { Host, HostMember } from './types';

const maxHosts = 10;

export function EventHosts({
  id,
  hosts,
  pending,
  onChange,
  onClose,
}: {
  id: string;
  hosts: Host[];
  pending: HostMember[];
  onChange: (left: boolean) => void;
  onClose: () => void;
}) {
  const field = useId();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState({ query: '', pages: [''] });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const full = hosts.length + pending.length >= maxHosts;
  const { data, error, loading, reload } = useApiResource<{
    items: HostMember[];
    next: string | null;
  }>(
    `/api/events/${id}/host-candidates?q=${encodeURIComponent(search.query)}&after=${encodeURIComponent(search.pages.at(-1) ?? '')}`,
  );
  async function run(
    action: (signal: AbortSignal) => Promise<unknown>,
    left = false,
  ) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure('');
    try {
      await action(controller.signal);
      if (controller.signal.aborted) return;
      setSearch((current) => ({ ...current, pages: [''] }));
      reload();
      onChange(left);
    } catch (error) {
      if (!controller.signal.aborted)
        setFailure(
          error instanceof Error ? error.message : 'Something went wrong.',
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function searchMembers(event: FormEvent) {
    event.preventDefault();
    setSearch({ query: input.trim(), pages: [''] });
  }
  return (
    <Dialog title="Hosts" busy={busy} onClose={onClose}>
      <ul className="event-guest-list event-host-list">
        {hosts.map((host) => (
          <li key={host.handle}>
            <PersonPhoto
              name={host.displayName}
              profileHandle={host.hasAvatar && !busy ? host.handle : undefined}
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
                    (signal) =>
                      api(
                        `/api/events/${id}/hosts/${encodeURIComponent(host.handle)}`,
                        { method: 'DELETE', signal },
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
        {pending.map((member) => (
          <li key={member.id}>
            <PersonPhoto
              name={member.displayName}
              profileHandle={!busy ? member.handle : undefined}
              src={guestPhoto(member)}
              size={36}
            />
            <span className="event-host-pending">
              <strong>{member.displayName}</strong>
              <span className="event-list-meta">Pending</span>
            </span>
            <button
              type="button"
              className="compact-button"
              aria-label={`Cancel invitation for ${member.displayName}`}
              disabled={busy}
              onClick={() =>
                void run((signal) =>
                  api(`/api/events/${id}/hosts`, {
                    ...jsonRequest('DELETE', { userId: member.id }),
                    signal,
                  }),
                )
              }
            >
              <span>Remove</span>
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={searchMembers}>
        <label htmlFor={field} className="field-label">
          Find a co-host
        </label>
        <p className="field-help">
          Search people you follow or who follow you. They’ll get an invitation
          in Events.
        </p>
        <div className="actions">
          <input
            id={field}
            type="search"
            maxLength={60}
            autoComplete="off"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            Search
          </button>
        </div>
      </form>
      {full && (
        <p role="status">
          An event can have up to {maxHosts} hosts, including pending
          invitations.
        </p>
      )}
      {loading && <p role="status">Loading connections…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button type="button" onClick={reload} disabled={busy}>
            Try again
          </button>
        </div>
      )}
      {data?.items.length === 0 && (
        <p>No matching connections with a profile photo.</p>
      )}
      <ul
        className="event-guest-list event-host-list"
        aria-label="Co-host connections"
      >
        {data?.items
          .filter(
            (member) => !pending.some((invite) => invite.id === member.id),
          )
          .map((member) => (
            <li key={member.id}>
              <PersonPhoto
                name={member.displayName}
                profileHandle={!busy ? member.handle : undefined}
                src={guestPhoto(member)}
                size={36}
              />
              <span className="event-host-pending">
                <strong>{member.displayName}</strong>
                <span className="event-list-meta">{member.handle}</span>
              </span>
              <button
                type="button"
                className="compact-button"
                aria-label={`Invite ${member.displayName} to co-host`}
                disabled={busy || full}
                onClick={() =>
                  void run((signal) =>
                    api(`/api/events/${id}/hosts`, {
                      ...jsonRequest('POST', { userId: member.id }),
                      signal,
                    }),
                  )
                }
              >
                <span>Invite</span>
              </button>
            </li>
          ))}
      </ul>
      <nav className="actions" aria-label="Co-host connection pages">
        {search.pages.length > 1 && (
          <button
            type="button"
            disabled={busy || loading}
            onClick={() =>
              setSearch((current) => ({
                ...current,
                pages: current.pages.slice(0, -1),
              }))
            }
          >
            Previous
          </button>
        )}
        {data?.next && (
          <button
            type="button"
            disabled={busy || loading}
            onClick={() =>
              setSearch((current) => ({
                ...current,
                pages: [...current.pages, data.next!],
              }))
            }
          >
            Next
          </button>
        )}
      </nav>
      {failure && <p role="alert">{failure}</p>}
    </Dialog>
  );
}
