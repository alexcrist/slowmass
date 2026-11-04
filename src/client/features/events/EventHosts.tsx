import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
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
  const [query, setQuery] = useState('');
  // Successful host changes bump this so candidates are reread.
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const spotsLeft = Math.max(0, maxHosts - hosts.length - pending.length);
  const full = spotsLeft === 0;
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
      setVersion((current) => current + 1);
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
    setQuery(input.trim());
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
            <HostCandidates
              key={query}
              id={id}
              query={query}
              version={version}
              pending={pending}
              disabled={busy}
              full={full}
              onInvite={(member) =>
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
            />
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

const identify = (member: HostMember) => member.id;
// Accepted followers and following with a profile photo, loaded as the
// dialog scrolls. Remounted per search.
function HostCandidates({
  id,
  query,
  version,
  pending,
  disabled,
  full,
  onInvite,
}: {
  id: string;
  query: string;
  version: number;
  pending: HostMember[];
  disabled: boolean;
  full: boolean;
  onInvite: (member: HostMember) => void;
}) {
  const [history, setHistory] = useState(['']);
  const pages = useScrollPages({
    history: [history, setHistory],
    path: (after) =>
      `/api/events/${id}/host-candidates?q=${encodeURIComponent(query)}&after=${encodeURIComponent(after)}`,
    identify,
  });
  const { items, loading, revalidating, revalidate } = pages;
  const latest = useRef({ version, revalidate });
  useEffect(() => {
    latest.current.revalidate = revalidate;
  });
  useEffect(() => {
    if (latest.current.version === version) return;
    latest.current.version = version;
    latest.current.revalidate();
  }, [version]);
  const members = items?.filter(
    (member) => !pending.some((invite) => invite.id === member.id),
  );
  return (
    <>
      {loading && !items && (
        <p className="event-host-notice" role="status">
          Loading connections…
        </p>
      )}
      {!loading && members?.length === 0 && (
        <p className="event-host-notice">
          No matching connections with a profile photo.
        </p>
      )}
      <ul
        className="event-guest-list event-host-list"
        aria-label="Co-host connections"
      >
        {members?.map((member) => (
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
              disabled={disabled || full || revalidating}
              onClick={() => onInvite(member)}
            >
              <span>Invite</span>
            </button>
          </li>
        ))}
      </ul>
      <ScrollPagesEnd
        pages={pages}
        loading="Loading more connections…"
        more="Show more connections"
        disabled={disabled}
      />
    </>
  );
}
