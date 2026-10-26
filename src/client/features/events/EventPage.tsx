import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEventAppearance } from './useEventAppearance';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { OverflowMenu } from '../../ui/OverflowMenu';
import { EventAnswers, EventCover, EventSummary } from './EventSummary';
import { EventGuests } from './EventGuests';
import { EventLinkDialog } from './EventLinkDialog';
import { EventUpdateBlastDialog } from './EventUpdateBlastDialog';
import { EventCalendarDialog } from './EventCalendarDialog';
import { MailIcon } from '../../ui/MailIcon';
import { LockIcon } from '../../ui/LockIcon';
import { EventLog } from './EventLog';
import { EventJoin } from './EventJoin';
import { eventHref } from './navigation';
import type { Answer, EventView } from './types';

const linkToken = /^[a-zA-Z0-9]{48}$/;

// An event's one URL carries its link. Opening it records the link version for
// this member, then shows the event; internal links use the event ID. A member
// who hasn't named themselves sees only the preview, with the `join` form.
export function EventRoute({
  param,
  linkProfiles,
  join,
}: {
  param: string;
  linkProfiles: boolean;
  join?: ReactNode;
}) {
  const token = linkToken.test(param) ? param : null;
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<{
    token: string;
    attempt: number;
    id: string | null;
    event?: EventView;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const settle = (id: string | null, error = '', event?: EventView) => {
      if (!controller.signal.aborted)
        setOpened({ token, attempt, id, error, event });
    };
    api<{ id: string; event?: EventView }>('/api/events/open', {
      ...jsonRequest('POST', { token }),
      signal: controller.signal,
    })
      .then((result) => settle(result.id, '', result.event))
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
  const show = (id: string, event?: EventView) =>
    join ? (
      <EventJoin key={id} id={id} initialEvent={event}>
        {join}
      </EventJoin>
    ) : (
      <EventPage
        key={id}
        id={id}
        linkProfiles={linkProfiles}
        initialEvent={event}
      />
    );
  if (!token) return show(param);
  if (opened?.token !== token || opened.attempt !== attempt)
    return <p role="status">Opening event…</p>;
  return opened.id ? (
    show(opened.id, opened.event)
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
  initialEvent,
  id,
  linkProfiles,
}: {
  id: string;
  initialEvent?: EventView;
  linkProfiles: boolean;
}) {
  const { data, error, loading, reload, refresh } = useApiResource<{
    event: EventView;
  }>(
    `/api/events/${encodeURIComponent(id)}`,
    initialEvent ? { event: initialEvent } : undefined,
  );
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const deletion = useRef<AbortController | null>(null);
  useEffect(() => () => deletion.current?.abort(), []);
  const [failure, setFailure] = useState('');
  const [dialog, setDialog] = useState<
    | 'link'
    | 'update-blast'
    | 'cancel'
    | 'delete'
    | 'calendar'
    | 'decline-hosting'
    | null
  >(null);
  const [messageId] = useState(() => crypto.randomUUID());
  const [updateBlastsSent, setUpdateBlastsSent] = useState(0);
  const event = data?.event;
  useEventAppearance(event?.appearance);
  const url = event?.url;
  // Show the shareable URL in the address bar, so copying it works too.
  useEffect(() => {
    if (!url) return;
    const target = new URL(url);
    const path = target.pathname + target.hash;
    if (location.pathname + location.hash !== path)
      window.history?.replaceState(window.history.state, '', path);
  }, [url]);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure('');
    try {
      await action();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      running.current = false;
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
  // the link. Declining is confirmed first, since only a host can re-invite.
  function host(accept: boolean) {
    void run(async () => {
      await api(`/api/events/${id}/hosting`, {
        method: accept ? 'POST' : 'DELETE',
      });
      setDialog(null);
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
  const managing = event.viewer.isHost && !event.cancelled;
  const deleting = event.viewer.isCreator;
  const sharing = managing && Boolean(url);
  return (
    <article className="event">
      <EventCover event={event} />
      <div className="event-main">
        <EventSummary
          event={event}
          hosts={event.hosts}
          onAddToCalendar={
            event.cancelled ? undefined : () => setDialog('calendar')
          }
          actions={
            (managing || deleting) && (
              <div className="event-actions">
                {sharing && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Share event link"
                    aria-haspopup="dialog"
                    onClick={() => setDialog('link')}
                  >
                    <MailIcon />
                  </button>
                )}
                {(managing || deleting) && (
                  <OverflowMenu
                    label="Event options"
                    disabled={busy}
                    items={[
                      ...(managing
                        ? [
                            {
                              label: 'Edit event',
                              onSelect: () => {
                                location.hash = eventHref(id, 'edit');
                              },
                            },
                            {
                              label: 'Invite people',
                              onSelect: () => setDialog('link'),
                            },
                            {
                              label: 'Send update blast',
                              onSelect: () => setDialog('update-blast'),
                            },
                            {
                              label: 'Cancel event',
                              danger: true,
                              onSelect: () => setDialog('cancel'),
                            },
                          ]
                        : []),
                      ...(deleting
                        ? [
                            {
                              label: 'Delete event',
                              danger: true,
                              onSelect: () => setDialog('delete'),
                            },
                          ]
                        : []),
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
                {event.viewer.hostInvitedBy ?? 'A host'} invited you to co-host.
                Co-hosts are shown to everyone with the link.
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => host(true)}
              >
                Accept co-host invitation
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setDialog('decline-hosting')}
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
          {updateBlastsSent > 0 && <p role="status">Update blast sent.</p>}
          {event.counts ? (
            <>
              <section
                className="event-guests"
                aria-labelledby={`guests-${id}`}
              >
                <EventGuests
                  key={JSON.stringify(event.counts)}
                  id={id}
                  headingId={`guests-${id}`}
                  counts={event.counts}
                  linkProfiles={linkProfiles}
                />
              </section>
              <section aria-labelledby={`activity-${id}`}>
                <h2 id={`activity-${id}`}>Activity</h2>
                <EventLog
                  id={id}
                  linkProfiles={linkProfiles}
                  refreshVersion={updateBlastsSent}
                />
              </section>
            </>
          ) : (
            <section
              className="event-guests-locked"
              aria-labelledby={`guests-${id}`}
            >
              <h2 id={`guests-${id}`}>
                <LockIcon /> Guests
              </h2>
              <p>
                {open
                  ? 'RSVP to see who’s going.'
                  : 'The guest list is hidden. RSVPs are closed.'}
              </p>
            </section>
          )}
        </div>
      </div>
      {dialog === 'link' && sharing && url && (
        <EventLinkDialog url={url} onClose={closeDialog} />
      )}
      {dialog === 'calendar' && !event.cancelled && (
        <EventCalendarDialog event={event} onClose={closeDialog} />
      )}
      {dialog === 'update-blast' && managing && (
        <EventUpdateBlastDialog
          id={id}
          onClose={closeDialog}
          onSent={() => {
            closeDialog();
            setUpdateBlastsSent((value) => value + 1);
          }}
        />
      )}
      {dialog === 'decline-hosting' && (
        <ConfirmDialog
          title="Decline co-host invitation?"
          confirmLabel="Decline"
          danger
          busy={busy}
          error={failure}
          onClose={closeDialog}
          onConfirm={() => host(false)}
        >
          <p>
            You’ll still be able to see the event.{' '}
            {event.viewer.hostInvitedBy ?? 'A host'} would need to invite you
            again for you to co-host.
          </p>
        </ConfirmDialog>
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
      {dialog === 'delete' && deleting && (
        <ConfirmDialog
          title="Delete event?"
          confirmLabel="Delete event"
          danger
          busy={busy}
          error={failure}
          onClose={closeDialog}
          onConfirm={() =>
            void run(async () => {
              const controller = new AbortController();
              deletion.current = controller;
              await api(`/api/events/${id}`, {
                method: 'DELETE',
                signal: controller.signal,
                timeoutMs: 30000,
              });
              if (!controller.signal.aborted) location.hash = '#events';
            })
          }
        >
          <p>
            This removes the event for everyone and disables its link. Guests
            won’t be notified. This can’t be undone.
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}
