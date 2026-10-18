import { useEffect, useState } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { OverflowMenu } from '../../ui/OverflowMenu';
import { EventAnswers, EventSummary } from './EventSummary';
import { EventGuests } from './EventGuests';
import { EventLog } from './EventLog';
import { eventHref } from './EventsPage';
import type { Answer, EventView } from './types';

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
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
  const [status, setStatus] = useState('');
  const [manualLink, setManualLink] = useState('');
  const [failure, setFailure] = useState('');
  const [confirming, setConfirming] = useState<'replace' | 'cancel' | null>(
    null,
  );
  const [messageId] = useState(() => crypto.randomUUID());
  const event = data?.event;
  const url = event?.link.url;
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
    setStatus('');
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
  // Text the link from the share sheet where available; otherwise copy it.
  // The URL arrives with the event, so the share sheet opens within the tap
  // (Safari refuses it after waiting on a request).
  async function share(title: string) {
    if (!url) return;
    setFailure('');
    setStatus('');
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    if (await copy(url)) {
      setManualLink('');
      setStatus('Link copied.');
    } else {
      setManualLink(url);
      setStatus('Copy the link below to share it.');
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
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={reload}>Retry</button>
      </div>
    );
  if (!event) return loading ? <p role="status">Loading event…</p> : null;
  const open = !event.cancelled && !event.over;
  const shareButton = url && !event.cancelled && (
    <button
      type="button"
      className={event.viewer.isHost ? 'primary-button' : 'event-share'}
      disabled={busy}
      onClick={() => void share(event.title)}
    >
      Share link
    </button>
  );
  return (
    <article className="event">
      <EventSummary
        event={event}
        hosts={event.hosts}
        actions={
          event.viewer.isHost &&
          !event.cancelled && (
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
                  label: 'Replace link',
                  onSelect: () => setConfirming('replace'),
                },
                {
                  label: 'Cancel event',
                  danger: true,
                  onSelect: () => setConfirming('cancel'),
                },
              ]}
            />
          )
        }
      />
      <div className="event-details">
        {event.viewer.isHost ? (
          shareButton
        ) : (
          <>
            {open ? (
              <EventAnswers
                value={event.viewer.response}
                busy={busy}
                onAnswer={answer}
              />
            ) : (
              <p>Answers are closed.</p>
            )}
            {shareButton}
          </>
        )}
        {status && <p role="status">{status}</p>}
        {manualLink && (
          <input
            readOnly
            aria-label="Event link"
            value={manualLink}
            onFocus={(focus) => focus.target.select()}
          />
        )}
        {failure && !confirming && <p role="alert">{failure}</p>}
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
      {confirming === 'replace' && (
        <ConfirmDialog
          title="Replace link?"
          confirmLabel="Replace link"
          busy={busy}
          error={failure}
          onClose={() => {
            setConfirming(null);
            setFailure('');
          }}
          onConfirm={() =>
            void run(async () => {
              const replaced = await api<{
                link: { id: string; url: string };
              }>(
                `/api/events/${id}/link`,
                jsonRequest('POST', {
                  id: crypto.randomUUID(),
                  expectedId: event.link.id,
                }),
              );
              refresh((page) => ({
                event: { ...page.event, link: replaced.link },
              }));
              setManualLink('');
              setConfirming(null);
              setStatus('Link replaced. Share the new link.');
            })
          }
        >
          <p>
            The current link stops working, including sign-in emails people
            haven’t opened yet and people who opened the event without
            answering. Everyone who answered keeps access.
          </p>
        </ConfirmDialog>
      )}
      {confirming === 'cancel' && (
        <ConfirmDialog
          title="Cancel event?"
          confirmLabel="Cancel event"
          danger
          busy={busy}
          error={failure}
          onClose={() => {
            setConfirming(null);
            setFailure('');
          }}
          onConfirm={() =>
            void run(async () => {
              await api(
                `/api/events/${id}/cancel`,
                jsonRequest('POST', { messageId }),
              );
              setConfirming(null);
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
