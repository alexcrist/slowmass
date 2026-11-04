import { eventHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
import {
  EventDateIcon,
  EventLocationIcon,
  EventStatusIcon,
} from './EventIcons';
import { eventStart } from './time';
import { yourAnswer, type EventItem } from './types';

export function EventsPage({
  when,
  canCreate,
}: {
  when: 'upcoming' | 'past';
  canCreate: boolean;
}) {
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
      <EventList key={when} when={when} canCreate={canCreate} />
    </>
  );
}

const identify = (event: EventItem) => event.id;
function EventList({
  when,
  canCreate,
}: {
  when: 'upcoming' | 'past';
  canCreate: boolean;
}) {
  const pages = useScrollPages({
    history: usePageHistory(`events/${when}`),
    path: (cursor) =>
      `/api/events?when=${when}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    identify,
  });
  const { items, loading } = pages;
  return (
    <>
      {loading && !items && <p role="status">Loading events…</p>}
      {!loading && items?.length === 0 && (
        <p>
          {when === 'past'
            ? 'No past events.'
            : canCreate
              ? 'No upcoming events. Create one and share its link with friends.'
              : 'No upcoming events.'}
        </p>
      )}
      <ul className="notification-list event-list">
        {items?.map((event) => (
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
                <p className="event-list-meta">
                  <EventDateIcon />
                  <span>{eventStart(event)}</span>
                </p>
                {event.location && (
                  <p className="event-list-meta">
                    <EventLocationIcon />
                    <span>{event.location}</span>
                  </p>
                )}
                <p className="event-list-meta">
                  <EventStatusIcon />
                  <span>
                    {event.cancelled
                      ? 'Cancelled'
                      : event.hostInvited
                        ? 'Asked to co-host'
                        : yourAnswer(event.isHost, event.response)}
                  </span>
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
      <ScrollPagesEnd
        pages={pages}
        loading="Loading more events…"
        more="Show more events"
      />
    </>
  );
}
