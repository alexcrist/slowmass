import { useEffect, useState } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { OverflowMenu } from '../../ui/OverflowMenu';
import { EventAnswers, EventSummary } from './EventSummary';
import { EventGuests } from './EventGuests';
import { EventHosts } from './EventHosts';
import { EventLinkDialog } from './EventLinkDialog';
import { EventLog } from './EventLog';
import { eventHref } from './EventsPage';
import type { Answer, EventView } from './types';

const linkToken = /^[a-zA-Z0-9]{48}$/;

// An event's one URL carries its link. Opening it records the link version for
// this member, then shows the event; internal links use the event ID.
export function EventRoute({
  param,
  linkProfiles,
}: {
  param: string;
  linkProfiles: boolean;
}) {
  const token = linkToken.test(param) ? param : null;
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<{
    token: string;
    attempt: number;
    id: string | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const settle = (id: string | null, error = '') =>
      setOpened({ token, attempt, id, error });
    api<{ id: string }>('/api/events/open', {
      ...jsonRequest('POST', { token }),
      signal: controller.signal,
    })
      .then((result) => settle(result.id))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          settle(
            null,
            error instanceof Error
              ? error.message
              : 'Could not open this event.',
          );
      });
    return () => controller.abort();
  }, [token, attempt]);
  if (!token) return <EventPage id={param} linkProfiles={linkProfiles} />;
  if (opened?.token !== token || opened.attempt !== attempt)
    return <p role="status">Opening event…</p>;
  return opened.id ? (
    <EventPage id={opened.id} linkProfiles={linkProfiles} />
  ) : (
    <div>
      <p role="alert">{opened.error}</p>
      <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
    </div>
  );
}

// The event for its hosts, people who answered, and members who opened its
// current link. Only hosts and people who answered see the guests and activity.
export function EventPage({
  id,
  linkProfiles,
}: {
  id: string;
  linkProfiles: boolean;
}) {
  const { data, error, loading, reload, refresh } = useApiResource<{
    event: EventView;
  }>(`/api/events/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [dialog, setDialog] = useState<'link' | 'hosts' | 'cancel' | null>(
    null,
  );
  const [messageId] = useState(() => crypto.randomUUID());
  const event = data?.event;
  const url = event?.url;
  // Show the shareable URL in the address bar, so copying it works too.
  useEffect(() => {
    if (!url) return;
    const hash = new URL(url).hash;
    if (location.hash !== hash)
      window.history?.replaceState(window.history.state, '', hash);
  }, [url]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await action();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }
  function answer(value: Answer) {
    void run(async () => {
      await api(
        `/api/events/${id}/response`,
        jsonRequest('POST', { status: value }),
      );
      refresh((page) => ({
        event: {
          ...page.event,
          viewer: { ...page.event.viewer, response: value },
        },
      }));
    });
  }
  // Accepting is the member's consent to appear as a host to everyone with
  // the link.
  function host(accept: boolean) {
    void run(async () => {
      await api(`/api/events/${id}/hosting`, {
        method: accept ? 'POST' : 'DELETE',
      });
      refresh();
    });
  }
  function closeDialog() {
    setDialog(null);
    setFailure('');
  }
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={reload}>Retry</button>
      </div>
    );
  if (!event) return loading ? <p role="status">Loading event…</p> : null;
  const open = !event.cancelled && !event.over;
  const sharing = Boolean(url) && !event.cancelled;
  const managing = event.viewer.isHost && !event.cancelled;
  return (
    <article className="event">
      <EventSummary
        event={event}
        hosts={event.hosts}
        actions={
          (sharing || managing) && (
            <div className="event-actions">
              {sharing && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Share event link"
                  aria-haspopup="dialog"
                  onClick={() => setDialog('link')}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
                    <path d="m3.5 6.5 8.5 7 8.5-7" />
                  </svg>
                </button>
              )}
              {managing && (
                <OverflowMenu
                  label="Event options"
                  disabled={busy}
                  items={[
                    {
                      label: 'Edit event',
                      onSelect: () => {
                        location.hash = eventHref(id, 'edit');
                      },
                    },
                    {
                      label: 'Edit hosts',
                      onSelect: () => setDialog('hosts'),
                    },
                    {
                      label: 'Cancel event',
                      danger: true,
                      onSelect: () => setDialog('cancel'),
                    },
                  ]}
                />
              )}
            </div>
          )
        }
      />
      <div className="event-details">
        {event.viewer.hostInvited && (
          <div className="event-notice event-host-invite">
            <p>
              You’ve been asked to host this event. Hosts appear with their name
              and profile photo to everyone with the link.
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => host(true)}
            >
              Become a host
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => host(false)}
            >
              Decline
            </button>
          </div>
        )}
        {open ? (
          <EventAnswers
            value={event.viewer.response}
            busy={busy}
            onAnswer={answer}
          />
        ) : (
          <p>Answers are closed.</p>
        )}
        {failure && !dialog && <p role="alert">{failure}</p>}
        {event.counts ? (
          <>
            <section aria-labelledby={`guests-${id}`}>
              <h2 id={`guests-${id}`}>Guests</h2>
              <EventGuests
                key={JSON.stringify(event.counts)}
                id={id}
                counts={event.counts}
                linkProfiles={linkProfiles}
              />
            </section>
            <section aria-labelledby={`activity-${id}`}>
              <h2 id={`activity-${id}`}>Activity</h2>
              <EventLog id={id} linkProfiles={linkProfiles} />
            </section>
          </>
        ) : (
          open && (
            <p className="status-copy">
              Answer to see who’s going and the event’s activity.
            </p>
          )
        )}
      </div>
      {dialog === 'link' && url && (
        <EventLinkDialog url={url} onClose={closeDialog} />
      )}
      {dialog === 'hosts' && (
        <EventHosts
          id={id}
          hosts={event.hosts}
          pending={event.pendingHosts}
          onClose={closeDialog}
          onChange={(left) => {
            // Someone who stops hosting may no longer see the event.
            if (left) location.hash = '#events';
            else refresh();
          }}
        />
      )}
      {dialog === 'cancel' && (
        <ConfirmDialog
          title="Cancel event?"
          confirmLabel="Cancel event"
          danger
          busy={busy}
          error={failure}
          onClose={closeDialog}
          onConfirm={() =>
            void run(async () => {
              await api(
                `/api/events/${id}/cancel`,
                jsonRequest('POST', { messageId }),
              );
              setDialog(null);
              reload();
            })
          }
        >
          <p>
            Everyone who answered is notified. The event stays visible as
            cancelled, and this can’t be undone.
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}
