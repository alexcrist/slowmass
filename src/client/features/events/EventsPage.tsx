import { useApiResource } from '../../api/useApiResource';
import { usePageHistory } from '../../navigation/PageHistory';
import { eventStart } from './time';
import { yourAnswer, type EventItem } from './types';

export function eventHref(id: string, view = '') {
  return `#event/${encodeURIComponent(id)}${view ? `/${view}` : ''}`;
}

export function EventsPage({
  when,
  canCreate,
}: {
  when: 'upcoming' | 'past';
  canCreate: boolean;
}) {
  const [history, setHistory] = usePageHistory(`events/${when}`);
  const cursor = history[history.length - 1];
  const { data, error, loading, reload } = useApiResource<{
    items: EventItem[];
    next: string | null;
  }>(
    `/api/events?when=${when}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  return (
    <>
      {/* New event shares the tab row but sits apart: an action, not a view. */}
      <div className="events-tabs">
        <nav className="profile-tabs" aria-label="Events">
          <a
            className="profile-tab"
            href="#events"
            aria-current={when === 'upcoming' ? 'page' : undefined}
          >
            Upcoming
          </a>
          <a
            className="profile-tab"
            href="#events/past"
            aria-current={when === 'past' ? 'page' : undefined}
          >
            Past
          </a>
        </nav>
        {canCreate && (
          <a className="events-new" href="#new-event">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New event
          </a>
        )}
      </div>
      {loading && !data && <p role="status">Loading events…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      {data?.items.length === 0 && (
        <p>
          {when === 'past'
            ? 'No past events.'
            : canCreate
              ? 'No upcoming events. Create one and share its link with friends.'
              : 'No upcoming events.'}
        </p>
      )}
      <ul className="notification-list event-list">
        {data?.items.map((event) => (
          <li key={event.id}>
            <a className="notification-post" href={eventHref(event.id)}>
              <img
                className="notification-thumbnail"
                src={event.thumbnailUrl}
                width={64}
                height={64}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <div className="notification-content">
                <p>
                  <strong>{event.title}</strong>
                </p>
                <p className="event-list-meta">{eventStart(event)}</p>
                {event.location && (
                  <p className="event-list-meta">{event.location}</p>
                )}
                <p className="event-list-meta">
                  {event.cancelled
                    ? 'Cancelled'
                    : yourAnswer(event.isHost, event.response)}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
      <nav className="actions" aria-label="Event pages">
        {history.length > 1 && (
          <button
            disabled={loading}
            onClick={() => setHistory(history.slice(0, -1))}
          >
            {when === 'past' ? 'Newer' : 'Earlier'}
          </button>
        )}
        {data?.next && (
          <button
            disabled={loading}
            onClick={() => setHistory([...history, data.next!])}
          >
            {when === 'past' ? 'Older' : 'Later'}
          </button>
        )}
      </nav>
    </>
  );
}
