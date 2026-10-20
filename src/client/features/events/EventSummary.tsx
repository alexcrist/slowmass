import { useId, useState, type ReactNode } from 'react';
import { profileHref } from '../../navigation';
import { ImageViewer } from '../../ui/ImageViewer';
import { EventDateIcon, EventLocationIcon, EventTimeIcon } from './EventIcons';
import { eventWhen } from './time';
import {
  answerEmoji,
  answers,
  type Answer,
  type EventDetails,
  type Host,
} from './types';

// Members without a profile photo show their initial instead.
export function PersonPhoto({
  name,
  src,
  size,
  profileHandle,
}: {
  name: string;
  src: string | null;
  size: number;
  profileHandle?: string;
}) {
  const photo = src ? (
    <img
      className="event-person-photo"
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span
      className="event-person-initial"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
  return profileHandle ? (
    <a
      className="event-person-link"
      href={profileHref(profileHandle)}
      aria-label={`View ${name}’s profile`}
    >
      {photo}
    </a>
  ) : (
    photo
  );
}

// The cover's ratio also sizes it to the viewport beside wide-screen details.
export function EventCover({ event }: { event: EventDetails }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="event-photo event-photo-button"
        style={{
          ['--event-photo-ratio' as string]: `${event.width} / ${event.height}`,
        }}
        aria-label="Enlarge event photo"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <img
          src={event.photoUrl}
          width={event.width}
          height={event.height}
          alt={`Cover photo for ${event.title}`}
          fetchPriority="high"
        />
      </button>
      {open && (
        <ImageViewer
          title="Event photo"
          src={event.photoUrl}
          alt={`Cover photo for ${event.title}`}
          width={event.width}
          height={event.height}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// The editor shows hosts without profile links, so a click can't drop a draft.
export function EventHostRow({
  hosts,
  linked,
}: {
  hosts: Host[];
  linked: boolean;
}) {
  return (
    <div className="event-hosts">
      <svg
        className="event-host-crown"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m3 6 4.5 4L12 3l4.5 7L21 6l-2 12H5L3 6Z" />
        <path d="M5 21h14" />
      </svg>
      <span className="event-host-photos">
        {hosts.map((host) => (
          <PersonPhoto
            key={host.handle}
            name={host.displayName}
            profileHandle={linked && host.hasAvatar ? host.handle : undefined}
            src={
              host.hasAvatar
                ? `/media/avatar/${encodeURIComponent(host.handle)}`
                : null
            }
            size={32}
          />
        ))}
      </span>
      <p>
        Hosted by{' '}
        {new Intl.ListFormat(undefined, { type: 'conjunction' }).format(
          hosts.map((host) => host.displayName),
        )}
      </p>
    </div>
  );
}

export function EventSummary({
  event,
  hosts,
  actions,
  onAddToCalendar,
}: {
  event: EventDetails;
  hosts: Host[];
  // Controls shown beside the title, such as the host's menu.
  actions?: ReactNode;
  onAddToCalendar?: () => void;
}) {
  const when = eventWhen(event);
  return (
    <div className="event-details">
      {event.cancelled ? (
        <p className="event-notice">This event was cancelled.</p>
      ) : (
        event.over && <p className="event-notice">This event is over.</p>
      )}
      <div className="event-title-row">
        <h2 className="event-title">{event.title}</h2>
        {actions}
      </div>
      <div className="event-information">
        <p className="event-detail-row event-when">
          <EventDateIcon />
          <strong>{when.date}</strong>
        </p>
        <p className="event-detail-row event-when">
          <EventTimeIcon />
          <span>{when.time}</span>
        </p>
        {event.location && (
          <p className="event-detail-row event-location">
            <EventLocationIcon />
            <span>{event.location}</span>
          </p>
        )}
        {onAddToCalendar && (
          <button
            type="button"
            className="button-link event-calendar-button"
            aria-haspopup="dialog"
            onClick={onAddToCalendar}
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
              <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M16 3v4M8 3v4M3 11h18M19 15v8M15 19h8" />
            </svg>
            Add to calendar
          </button>
        )}
        {hosts.length > 0 && <EventHostRow hosts={hosts} linked />}
        {event.description && (
          <p className="event-description">{event.description}</p>
        )}
      </div>
    </div>
  );
}

export function EventAnswers({
  value,
  busy,
  onAnswer,
}: {
  value: Answer | null;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
}) {
  const id = useId();
  const [options, setOptions] = useState({ value, expanded: value === null });
  // Only a confirmed answer change collapses the choices. A failed save keeps
  // the current answer and expanded options, without a second mutation.
  if (options.value !== value) setOptions({ value, expanded: value === null });
  const expanded = options.value === value ? options.expanded : value === null;
  return (
    <div
      className="event-answers"
      role="group"
      aria-label="Your answer"
      data-answer={value ?? undefined}
      data-expanded={expanded}
    >
      <span id={`${id}-hint`} className="visually-hidden">
        {expanded
          ? 'Activate to hide the other answer options.'
          : 'Activate to show all answer options.'}
      </span>
      {answers.map((answer) => {
        const selected = value === answer.value;
        const hidden = !expanded && !selected;
        return (
          <div
            key={answer.value}
            id={`${id}-${answer.value}`}
            className="event-answer-slot"
            aria-hidden={hidden || undefined}
          >
            <button
              type="button"
              className="event-answer"
              aria-pressed={selected}
              aria-expanded={selected ? expanded : undefined}
              aria-controls={
                selected
                  ? answers
                      .filter((other) => other.value !== value)
                      .map((other) => `${id}-${other.value}`)
                      .join(' ')
                  : undefined
              }
              aria-describedby={selected ? `${id}-hint` : undefined}
              disabled={busy || hidden}
              tabIndex={hidden ? -1 : undefined}
              onClick={() => {
                if (busy || hidden) return;
                if (selected) setOptions({ value, expanded: !expanded });
                else onAnswer(answer.value);
              }}
            >
              <span className="event-answer-emoji" aria-hidden="true">
                {answerEmoji[answer.value]}
              </span>
              {answer.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
