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
  onChange: (left: boolean, hosts: Host[], pending: HostMember[]) => void;
  onClose: () => void;
}) {
  const field = useId();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState({ query: '', pages: [''] });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const spotsLeft = Math.max(0, maxHosts - hosts.length - pending.length);
  const full = spotsLeft === 0;
  const { data, error, loading, reload } = useApiResource<{
    items: HostMember[];
    next: string | null;
  }>(
    `/api/events/${id}/host-candidates?q=${encodeURIComponent(search.query)}&after=${encodeURIComponent(search.pages.at(-1) ?? '')}`,
  );
  async function run(
    action: (signal: AbortSignal) => Promise<unknown>,
    nextHosts: Host[],
    nextPending: HostMember[],
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
      onChange(left, nextHosts, nextPending);
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
      <div className="event-host-manager">
        <p className="field-help">
          Hosts can edit the event and invite people. Changes save immediately.
        </p>
        <section
          className="event-host-group"
          aria-labelledby={`${field}-hosting`}
        >
          <div className="event-host-group-heading">
            <h3 id={`${field}-hosting`}>
              Hosting <span className="event-list-meta">{hosts.length}</span>
            </h3>
            <span className="event-list-meta">Creator can’t be removed</span>
          </div>
          <div className="event-host-card">
            <ul
              className="event-guest-list event-host-list"
              aria-label="Current hosts"
            >
              {hosts.map((host) => (
                <li key={host.handle}>
                  <PersonPhoto
                    name={host.displayName}
                    src={guestPhoto(host)}
                    size={36}
                  />
                  <span className="event-host-pending">
                    <strong>{host.displayName}</strong>
                    <span className="event-list-meta">
                      {host.isCreator
                        ? 'Creator'
                        : host.isViewer
                          ? 'You'
                          : 'Host'}
                    </span>
                  </span>
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
                          hosts.filter((item) => item.handle !== host.handle),
                          pending,
                          host.isViewer,
                        )
                      }
                    >
                      <span>{host.isViewer ? 'Stop hosting' : 'Remove'}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section
          className="event-host-group"
          aria-labelledby={`${field}-invited`}
        >
          <div className="event-host-group-heading">
            <h3 id={`${field}-invited`}>
              Invited <span className="event-list-meta">{pending.length}</span>
            </h3>
            <span className="event-list-meta">Waiting to accept</span>
          </div>
          <div className="event-host-card">
            {pending.length === 0 && (
              <p className="event-host-notice">No pending invitations.</p>
            )}
            <ul
              className="event-guest-list event-host-list"
              aria-label="Pending host invitations"
            >
              {pending.map((member) => (
                <li key={member.id}>
                  <PersonPhoto
                    name={member.displayName}
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
                      void run(
                        (signal) =>
                          api(`/api/events/${id}/hosts`, {
                            ...jsonRequest('DELETE', { userId: member.id }),
                            signal,
                          }),
                        hosts,
                        pending.filter((item) => item.id !== member.id),
                      )
                    }
                  >
                    <span>Cancel invite</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section
          className="event-host-group"
          aria-labelledby={`${field}-invite`}
        >
          <div className="event-host-group-heading">
            <h3 id={`${field}-invite`}>
              <label htmlFor={field}>Invite a host</label>
            </h3>
            <span className="event-list-meta">
              {spotsLeft} of {maxHosts} spots left
            </span>
          </div>
          <p className="field-help">
            People you follow or who follow you. They become hosts after they
            accept.
          </p>
          <div className="event-host-card">
            <form
              className="event-host-search-controls"
              role="search"
              onSubmit={searchMembers}
            >
              <input
                id={field}
                type="search"
                placeholder="Name or username"
                maxLength={60}
                autoComplete="off"
                value={input}
                disabled={busy}
                onChange={(event) => setInput(event.target.value)}
              />
              <button type="submit" disabled={busy}>
                Search
              </button>
            </form>
            {full && (
              <p className="event-host-notice" role="status">
                An event can have up to {maxHosts} hosts, including pending
                invitations.
              </p>
            )}
            {loading && (
              <p className="event-host-notice" role="status">
                Loading connections…
              </p>
            )}
            {error && (
              <div className="event-host-notice">
                <p role="alert">{error}</p>
                <button type="button" onClick={reload} disabled={busy}>
                  Try again
                </button>
              </div>
            )}
            {!loading &&
              !error &&
              data?.items.filter(
                (member) => !pending.some((invite) => invite.id === member.id),
              ).length === 0 && (
                <p className="event-host-notice">
                  No matching connections with a profile photo.
                </p>
              )}
            <ul
              className="event-guest-list event-host-list"
              aria-label="Co-host connections"
            >
              {!loading &&
                !error &&
                data?.items
                  .filter(
                    (member) =>
                      !pending.some((invite) => invite.id === member.id),
                  )
                  .map((member) => (
                    <li key={member.id}>
                      <PersonPhoto
                        name={member.displayName}
                        src={guestPhoto(member)}
                        size={36}
                      />
                      <span className="event-host-pending">
                        <strong>{member.displayName}</strong>
                        <span className="event-list-meta">{member.handle}</span>
                      </span>
                      <button
                        type="button"
                        className="compact-button primary-button"
                        aria-label={`Invite ${member.displayName} to co-host`}
                        disabled={busy || full}
                        onClick={() =>
                          void run(
                            (signal) =>
                              api(`/api/events/${id}/hosts`, {
                                ...jsonRequest('POST', { userId: member.id }),
                                signal,
                              }),
                            hosts,
                            [...pending, member],
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
          </div>
        </section>
        {failure && <p role="alert">{failure}</p>}
        <button
          type="button"
          className="event-host-done"
          disabled={busy}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}
