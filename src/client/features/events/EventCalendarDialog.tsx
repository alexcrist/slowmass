import { calendarLinks } from '../../../shared/event-calendar';
import { Dialog } from '../../ui/Dialog';
import type { EventDetails } from './types';

export function EventCalendarDialog({
  event,
  onClose,
}: {
  event: EventDetails;
  onClose: () => void;
}) {
  const links = calendarLinks(event, location.origin);
  return (
    <Dialog title="Add to calendar" onClose={onClose}>
      <nav className="event-calendar-options" aria-label="Calendar provider">
        <a
          className="button-link"
          href={links.google}
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Calendar
        </a>
        <a
          className="button-link"
          href={`/api/events/${encodeURIComponent(event.id)}/calendar.ics`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Apple Calendar
        </a>
        <a
          className="button-link"
          href={links.outlook}
          target="_blank"
          rel="noopener noreferrer"
        >
          Outlook
        </a>
      </nav>
    </Dialog>
  );
}
