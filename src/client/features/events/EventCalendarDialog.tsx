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
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22ZM6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.49H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.51l3.34-2.59ZM12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.72 9.39 5.96 12 5.96Z" />
          </svg>
          <span>Google Calendar</span>
        </a>
        <a
          className="button-link"
          href={`/api/events/${encodeURIComponent(event.id)}/calendar.ics`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M17.05 12.54c.03 3.2 2.81 4.27 2.84 4.28-.02.08-.45 1.52-1.47 3.01-.88 1.29-1.8 2.57-3.24 2.6-1.41.03-1.86-.84-3.47-.84s-2.11.81-3.44.87c-1.39.05-2.45-1.4-3.34-2.68-1.81-2.62-3.2-7.4-1.34-10.63a5.18 5.18 0 0 1 4.39-2.66c1.37-.03 2.67.93 3.51.93.84 0 2.42-1.15 4.08-.98.7.03 2.67.28 3.94 2.14-.1.06-2.48 1.45-2.46 4.96ZM14.4 4.7c.74-.9 1.24-2.15 1.1-3.4-1.07.04-2.37.72-3.14 1.62-.69.8-1.29 2.08-1.13 3.3 1.19.09 2.41-.61 3.17-1.52Z" />
          </svg>
          <span>Apple Calendar</span>
        </a>
        <a
          className="button-link"
          href={links.outlook}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3h9v10M14 6h2M14 9h2M11 10h11v11H10M11 11l5.5 4L22 11" />
            <path d="m2 6 10-2v17L2 19Z" fill="currentColor" stroke="none" />
            <ellipse cx="7" cy="12.5" rx="2.2" ry="3.5" stroke="var(--paper)" />
          </svg>
          <span>Outlook</span>
        </a>
      </nav>
    </Dialog>
  );
}
