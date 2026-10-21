import type { ReactNode } from 'react';
import { useApiResource } from '../../api/useApiResource';
import { EventPreviewSummary } from './EventPreview';
import { eventWhen } from './time';
import type { EventView } from './types';
import { useEventAppearance } from './useEventAppearance';

// Someone who signed in through an event's link names themselves before seeing
// its details. Until then the event shows what its signed-out preview does,
// with the member app's name form in place of the email form. Their session
// already authorizes the event, so the cover loads directly.
export function EventJoin({
  id,
  initialEvent,
  children,
}: {
  id: string;
  initialEvent?: EventView;
  children: ReactNode;
}) {
  const { data, error, reload } = useApiResource<{ event: EventView }>(
    `/api/events/${encodeURIComponent(id)}`,
    initialEvent ? { event: initialEvent } : undefined,
  );
  const event = data?.event;
  useEventAppearance(event?.appearance);
  return (
    <>
      {event ? (
        <EventPreviewSummary
          title={event.title}
          date={eventWhen(event).date}
          width={event.width}
          height={event.height}
        >
          <img
            src={event.photoUrl}
            width={event.width}
            height={event.height}
            alt={`Cover photo for ${event.title}`}
            fetchPriority="high"
          />
        </EventPreviewSummary>
      ) : error ? (
        <div className="event-preview-intro">
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </div>
      ) : (
        <p role="status" className="event-preview-intro">
          Loading event…
        </p>
      )}
      <div className="event-preview-intro">
        <p className="status-copy">Enter your name to see details and RSVP.</p>
        <p className="status-copy">Hosts and other guests see this name.</p>
      </div>
      <div className="event-join-form">{children}</div>
    </>
  );
}
