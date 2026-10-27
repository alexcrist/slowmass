import { useId, useRef, useState } from 'react';
import { useApiResource } from '../../api/useApiResource';
import { profileHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
import { Dialog } from '../../ui/Dialog';
import { PersonPhoto } from './EventSummary';
import { answerEmoji, answers, type Answer } from './types';

type Guest = { handle: string; displayName: string; hasAvatar: boolean };

// Members without a profile photo have no profile page to open.
export function GuestName({
  guest,
  linkProfiles,
}: {
  guest: Guest;
  linkProfiles: boolean;
}) {
  return linkProfiles && guest.hasAvatar ? (
    <a href={profileHref(guest.handle)}>
      <strong>{guest.displayName}</strong>
    </a>
  ) : (
    <strong>{guest.displayName}</strong>
  );
}
export function guestPhoto(guest: Guest) {
  return guest.hasAvatar
    ? `/media/avatar/${encodeURIComponent(guest.handle)}`
    : null;
}

// The page shows a row of guests; View all opens every answer's full list.
const rowSize = 5;

export function EventGuests({
  id,
  headingId,
  counts,
  linkProfiles,
}: {
  id: string;
  headingId: string;
  counts: Record<Answer, number>;
  linkProfiles: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Going leads the row; an event with no one going yet shows maybe instead.
  const shown = answers.find(
    (answer) => answer.value !== 'declined' && counts[answer.value] > 0,
  );
  const summary = answers
    .filter((answer) => counts[answer.value] > 0)
    .map((answer) => `${counts[answer.value]} ${answer.label.toLowerCase()}`)
    .join(' · ');
  return (
    <>
      <div className="event-guests-heading">
        <div>
          <h2 id={headingId}>Guests</h2>
          <p>{summary || 'No answers yet.'}</p>
        </div>
        <button type="button" onClick={() => setOpen(true)}>
          View all
        </button>
      </div>
      {shown && (
        <GuestRow
          id={id}
          answer={shown}
          total={counts[shown.value]}
          onMore={() => setOpen(true)}
        />
      )}
      {open && (
        <Dialog title="Guests" onClose={() => setOpen(false)}>
          <GuestList id={id} counts={counts} linkProfiles={linkProfiles} />
        </Dialog>
      )}
    </>
  );
}

function GuestRow({
  id,
  answer,
  total,
  onMore,
}: {
  id: string;
  answer: (typeof answers)[number];
  total: number;
  onMore: () => void;
}) {
  const { data, error, loading, reload } = useApiResource<{
    items: Guest[];
    next: string | null;
  }>(`/api/events/${id}/guests?status=${answer.value}`);
  if (loading && !data) return <p role="status">Loading guests…</p>;
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={reload}>Retry</button>
      </div>
    );
  if (!data) return null;
  // A full row ends with a count of everyone else instead of a fifth guest.
  const guests =
    total > rowSize ? data.items.slice(0, rowSize - 1) : data.items;
  const more = total - guests.length;
  return (
    <ul className="event-guest-row">
      {guests.map((guest) => (
        <li key={guest.handle}>
          <PersonPhoto
            name={guest.displayName}
            profileHandle={guest.hasAvatar ? guest.handle : undefined}
            src={guestPhoto(guest)}
            size={52}
          />
          <span className="visually-hidden">{guest.displayName}</span>
        </li>
      ))}
      {more > 0 && (
        <li>
          <button
            type="button"
            className="event-guest-more"
            aria-label={`View all ${total} ${answer.label.toLowerCase()}`}
            onClick={onMore}
          >
            +{more}
          </button>
        </li>
      )}
    </ul>
  );
}

function GuestList({
  id,
  counts,
  linkProfiles,
}: {
  id: string;
  counts: Record<Answer, number>;
  linkProfiles: boolean;
}) {
  const tabs = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState<Answer>('going');
  const [history, setHistory] = usePageHistory(`event/${id}/${selected}`);
  const cursor = history[history.length - 1];
  const { data, error, loading, reload } = useApiResource<{
    items: Guest[];
    next: string | null;
  }>(
    `/api/events/${id}/guests?status=${selected}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  function select(index: number) {
    setSelected(answers[index].value);
    buttons.current[index]?.focus();
  }
  return (
    <>
      <div className="profile-tabs" role="tablist" aria-label="Guests">
        {answers.map((answer, index) => (
          <button
            key={answer.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            className="profile-tab"
            id={`${tabs}-${answer.value}`}
            aria-controls={`${tabs}-panel`}
            aria-selected={selected === answer.value}
            tabIndex={selected === answer.value ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(key) => {
              const next =
                key.key === 'ArrowRight'
                  ? (index + 1) % answers.length
                  : key.key === 'ArrowLeft'
                    ? (index + answers.length - 1) % answers.length
                    : null;
              if (next === null) return;
              key.preventDefault();
              select(next);
            }}
          >
            <span aria-hidden="true">{answerEmoji[answer.value]}</span>{' '}
            {answer.label} {counts[answer.value]}
          </button>
        ))}
      </div>
      <div
        id={`${tabs}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabs}-${selected}`}
      >
        {loading && !data && <p role="status">Loading guests…</p>}
        {error && (
          <div>
            <p role="alert">{error}</p>
            <button onClick={reload}>Retry</button>
          </div>
        )}
        {data?.items.length === 0 && <p>No one yet.</p>}
        <ul className="event-guest-list">
          {data?.items.map((guest) => (
            <li key={guest.handle}>
              <PersonPhoto
                name={guest.displayName}
                profileHandle={guest.hasAvatar ? guest.handle : undefined}
                src={guestPhoto(guest)}
                size={36}
              />
              <GuestName guest={guest} linkProfiles={linkProfiles} />
            </li>
          ))}
        </ul>
        <nav className="actions" aria-label="Guest pages">
          {history.length > 1 && (
            <button
              disabled={loading}
              onClick={() => setHistory(history.slice(0, -1))}
            >
              Newer
            </button>
          )}
          {data?.next && (
            <button
              disabled={loading}
              onClick={() => setHistory([...history, data.next!])}
            >
              Older
            </button>
          )}
        </nav>
      </div>
    </>
  );
}
