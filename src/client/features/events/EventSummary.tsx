import type { ReactNode } from 'react';
import { profileHref } from '../../navigation';
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

export function EventSummary({
  event,
  hosts,
  actions,
}: {
  event: EventDetails;
  hosts: Host[];
  // Controls shown beside the title, such as the host's menu.
  actions?: ReactNode;
}) {
  const when = eventWhen(event);
  return (
    <div className="event-summary">
      <div
        className="event-photo"
        style={{ aspectRatio: `${event.width} / ${event.height}` }}
      >
        <img
          src={event.photoUrl}
          width={event.width}
          height={event.height}
          alt={`Cover photo for ${event.title}`}
          fetchPriority="high"
        />
      </div>
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
        <p className="event-when">
          <strong>{when.date}</strong>
          <br />
          {when.time}
        </p>
        {event.location && <p className="event-location">{event.location}</p>}
        {hosts.length > 0 && (
          <div className="event-hosts">
            <span className="event-host-photos">
              {hosts.map((host) => (
                <PersonPhoto
                  key={host.handle}
                  name={host.displayName}
                  profileHandle={host.hasAvatar ? host.handle : undefined}
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
        )}
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
  return (
    <div className="event-answers" role="group" aria-label="Your answer">
      {answers.map((answer) => (
        <button
          key={answer.value}
          type="button"
          className="event-answer"
          aria-pressed={value === answer.value}
          disabled={busy}
          onClick={() => onAnswer(answer.value)}
        >
          <span className="event-answer-emoji" aria-hidden="true">
            {answerEmoji[answer.value]}
          </span>
          {answer.label}
        </button>
      ))}
    </div>
  );
}
