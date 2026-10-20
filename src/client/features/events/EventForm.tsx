import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { api, jsonRequest } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { useApiResource } from '../../api/useApiResource';
import { PostCropEditor, fullPhoto, type Rectangle } from '../posts';
import {
  clockTime,
  currentTimeZone,
  eventWhen,
  fromZoned,
  zonedInput,
  zoneName,
} from './time';
import type { EventView, Host } from './types';
import {
  originalAppearance,
  type EventAppearance,
} from '../../../shared/event-appearance';
import { EventAppearanceDialog } from './EventAppearanceDialog';
import { useEventAppearance } from './useEventAppearance';
import { EventDateIcon, EventLocationIcon, EventTimeIcon } from './EventIcons';
import { EventHostRow } from './EventSummary';

function nextDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

// An end time at or before the start means the event ends the next day.
const endsNextDay = (startTime: string, endTime: string) =>
  endTime !== '' && endTime <= startTime;

// The draft's instants, or null until it has a date and start time.
function draftTimes(
  date: string,
  startTime: string,
  endTime: string,
  timeZone: string,
) {
  const startsAt = fromZoned(date, startTime, timeZone);
  if (startsAt === null) return null;
  const endsAt = endTime
    ? fromZoned(
        endsNextDay(startTime, endTime) ? nextDay(date) : date,
        endTime,
        timeZone,
      )
    : null;
  return { startsAt, endsAt };
}

function openPicker(input: HTMLInputElement) {
  try {
    input.showPicker();
  } catch {
    // Without picker support, the focused field still takes typed input.
  }
}

// Page text over a transparent native input, so selecting the text opens the
// browser's own date or time picker in place.
function PickerField({
  children,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return (
    <span className="event-picker event-editable">
      <span aria-hidden="true">{children}</span>
      <input
        {...input}
        onClick={(click) => openPicker(click.currentTarget)}
        onKeyDown={(key) => {
          // Enter would otherwise submit the form.
          if (key.key !== 'Enter' && key.key !== ' ') return;
          key.preventDefault();
          openPicker(key.currentTarget);
        }}
      />
    </span>
  );
}

// Text edited in place, in the type of the page text it previews. A hidden
// copy sizes the field so it wraps and grows like that text.
function InlineField({
  multiline = false,
  value,
  placeholder,
  ...field
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  multiline?: boolean;
  value: string;
  placeholder: string;
}) {
  return (
    <span className="event-field event-editable">
      <span className="event-field-size" aria-hidden="true">
        {(value || placeholder) + ' '}
      </span>
      <textarea
        {...field}
        rows={1}
        value={value}
        placeholder={placeholder}
        onKeyDown={(key) => {
          if (!multiline && key.key === 'Enter') key.preventDefault();
        }}
      />
    </span>
  );
}

// Title and location are single lines; pasted line breaks become spaces.
const oneLine = (value: string) => value.replace(/\r?\n/g, ' ');

function CoverIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-11 9" />
    </svg>
  );
}

export function EditEvent({
  id,
  onSaved,
  onCancel,
}: {
  id: string;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const { data, error, reload } = useApiResource<{ event: EventView }>(
    `/api/events/${encodeURIComponent(id)}`,
  );
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={reload}>Retry</button>
      </div>
    );
  if (!data) return <p role="status">Loading event…</p>;
  if (!data.event.viewer.isHost || data.event.cancelled)
    return <p>Only hosts can edit an event that hasn’t been cancelled.</p>;
  return (
    <EventForm
      key={data.event.id}
      event={data.event}
      hosts={data.event.hosts}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

// The event page, edited in place: selecting the cover, title, date and time,
// location, or description edits it. New events need a cover photo; hosts can
// replace it when editing. Times are entered in the event's time zone (the
// creator's, for new events).
export function EventForm({
  event,
  hosts,
  onSaved,
  onCancel,
}: {
  event?: EventView;
  hosts: Host[];
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [appearance, setAppearance] = useState(
    event?.appearance ?? originalAppearance,
  );
  const [appearancePreview, setAppearancePreview] =
    useState<EventAppearance | null>(null);
  const [appearanceDialog, setAppearanceDialog] = useState<
    'color' | 'fonts' | null
  >(null);
  useEventAppearance(appearancePreview ?? appearance);
  function closeAppearance() {
    setAppearanceDialog(null);
    setAppearancePreview(null);
  }
  const timeZone = event?.timeZone ?? currentTimeZone();
  const start = event ? zonedInput(event.startsAt, timeZone) : null;
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(start?.date ?? '');
  const [startTime, setStartTime] = useState(start?.time ?? '');
  const [endTime, setEndTime] = useState(
    event?.endsAt ? zonedInput(event.endsAt, timeZone).time : '',
  );
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const times = draftTimes(date, startTime, endTime, timeZone);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const photoPreview = preview || event?.photoUrl;
  // A new cover takes its ratio once it loads; until then, and with no cover,
  // the frame uses 4:3.
  const coverSize = preview ? previewSize : event;
  const [source, setSource] = useState<{ file: File; crop: Rectangle } | null>(
    null,
  );
  const [editing, setEditing] = useState<{
    file: File;
    crop: Rectangle;
  } | null>(null);
  // Stable IDs make an unchanged retry converge; any edit starts a new attempt.
  const [id, setId] = useState(() => event?.id ?? crypto.randomUUID());
  const [upload, setUpload] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PhotoProgressState>({
    phase: 'saving',
  });
  const controller = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function changed<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      if (!event) {
        setId(crypto.randomUUID());
        setUpload(crypto.randomUUID());
      }
    };
  }
  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (busy || editing || appearanceDialog || controller.current) return;
    setError('');
    if (times === null) {
      setError('Choose a date and start time.');
      return;
    }
    if (!event && !file) {
      setError('Choose a cover photo.');
      return;
    }
    if (file && file.size > 8 * 1024 * 1024) {
      setError('Choose a photo smaller than 8 MB.');
      return;
    }
    setBusy(true);
    setProgress({ phase: file ? 'starting' : 'saving' });
    const request = new AbortController();
    controller.current = request;
    const details = {
      title,
      description,
      location,
      ...times,
      timeZone,
    };
    try {
      if (event)
        await api(`/api/events/${event.id}`, {
          ...jsonRequest('PATCH', details),
          signal: request.signal,
          timeoutMs: 30_000,
        });
      else
        await api('/api/events', {
          ...jsonRequest('POST', { id, ...details, appearance }),
          signal: request.signal,
          timeoutMs: 30_000,
        });
      if (request.signal.aborted) return;
      if (file)
        await api(`/api/events/${id}/photo`, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'Idempotency-Key': upload,
          },
          body: file,
          signal: request.signal,
          onUploadProgress: (percent) => {
            if (!request.signal.aborted)
              setProgress({
                phase: percent === 100 ? 'processing' : 'uploading',
                percent,
              });
          },
        });
      if (!request.signal.aborted) onSaved(id);
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'The event could not be saved. Try again.',
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        if (!request.signal.aborted) setBusy(false);
      }
    }
  }
  // The date reads as on the page as soon as it is chosen, before any time.
  const day = date ? fromZoned(date, '12:00', timeZone) : null;
  const dateText =
    day === null
      ? null
      : eventWhen({ startsAt: day, endsAt: null, timeZone }).date;
  // The abbreviation depends on the date (PST or PDT), so it waits for one.
  const zoneAt = times?.startsAt ?? day;
  const zone = zoneAt === null ? null : zoneName(zoneAt, timeZone);
  return (
    <>
      <form onSubmit={(submit) => void save(submit)}>
        <fieldset
          className="event-appearance-controls"
          disabled={busy || Boolean(editing)}
        >
          <legend className="visually-hidden">Appearance</legend>
          <div className="actions">
            <button
              type="button"
              className="event-color-button"
              aria-haspopup="dialog"
              onClick={() => setAppearanceDialog('color')}
            >
              Color theme
            </button>
            <button
              type="button"
              className="event-font-button"
              aria-haspopup="dialog"
              onClick={() => setAppearanceDialog('fonts')}
            >
              Fonts
            </button>
          </div>
        </fieldset>
        <div className="event">
          <div
            className="event-photo event-cover-editor"
            style={{
              ['--event-photo-ratio' as string]: coverSize
                ? `${coverSize.width} / ${coverSize.height}`
                : '4 / 3',
            }}
          >
            <input
              id="event-photo"
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={
                photoPreview ? 'Change cover photo' : 'Add cover photo'
              }
              disabled={busy}
              onChange={(change) => {
                const selected = change.target.files?.[0];
                change.target.value = '';
                if (selected) setEditing({ file: selected, crop: fullPhoto });
              }}
            />
            <label htmlFor="event-photo" className="event-cover-choose">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt={
                    preview
                      ? 'Selected cover photo preview'
                      : 'Current event cover photo'
                  }
                  width={preview ? undefined : event?.width}
                  height={preview ? undefined : event?.height}
                  onLoad={(load) => {
                    if (preview)
                      setPreviewSize({
                        width: load.currentTarget.naturalWidth,
                        height: load.currentTarget.naturalHeight,
                      });
                  }}
                />
              ) : (
                <span className="event-cover-empty">
                  <CoverIcon />
                  <strong>Add cover photo</strong>
                  <span>One still JPEG, PNG, or WebP.</span>
                </span>
              )}
            </label>
            {photoPreview && !busy && (
              <span className="event-cover-actions">
                {file && preview && (
                  <button
                    type="button"
                    className="event-cover-action"
                    onClick={() => setEditing(source)}
                  >
                    Adjust crop
                  </button>
                )}
                <label
                  htmlFor="event-photo"
                  className="event-cover-action"
                  aria-hidden="true"
                >
                  Change cover
                </label>
              </span>
            )}
          </div>
          <div className="event-main">
            <div className="event-details">
              <div className="event-title-row">
                <h2 className="event-title">
                  <InlineField
                    id="event-title"
                    aria-label="Title"
                    placeholder="Event title"
                    required
                    maxLength={120}
                    value={title}
                    disabled={busy}
                    onChange={(change) =>
                      changed(setTitle)(oneLine(change.target.value))
                    }
                  />
                </h2>
              </div>
              <div className="event-information">
                <p className="event-detail-row event-when">
                  <EventDateIcon />
                  <PickerField
                    id="event-date"
                    type="date"
                    aria-label="Date"
                    required
                    value={date}
                    disabled={busy}
                    onChange={(change) => changed(setDate)(change.target.value)}
                  >
                    <strong
                      className={dateText ? undefined : 'event-placeholder'}
                    >
                      {dateText ?? 'Choose a date'}
                    </strong>
                  </PickerField>
                </p>
                <p className="event-detail-row event-when">
                  <EventTimeIcon />
                  <span className="event-time-parts">
                    <PickerField
                      id="event-start"
                      type="time"
                      aria-label="Start time"
                      required
                      value={startTime}
                      disabled={busy}
                      onChange={(change) =>
                        changed(setStartTime)(change.target.value)
                      }
                    >
                      {startTime ? (
                        clockTime(startTime)
                      ) : (
                        <span className="event-placeholder">
                          Choose a start time
                        </span>
                      )}
                    </PickerField>
                    {startTime && (
                      <>
                        <span aria-hidden="true">–</span>
                        <PickerField
                          id="event-end"
                          type="time"
                          aria-label="End time (optional)"
                          value={endTime}
                          disabled={busy}
                          onChange={(change) =>
                            changed(setEndTime)(change.target.value)
                          }
                        >
                          {endTime ? (
                            <>
                              {clockTime(endTime)}
                              {endsNextDay(startTime, endTime) && (
                                <span className="event-placeholder">
                                  {' '}
                                  next day
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="event-placeholder">End time</span>
                          )}
                        </PickerField>
                        {zone && <span>{zone}</span>}
                        {endTime && (
                          <button
                            type="button"
                            className="icon-button event-clear-time"
                            aria-label="Remove end time"
                            disabled={busy}
                            onClick={() => changed(setEndTime)('')}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            >
                              <path d="M6 6l12 12M18 6 6 18" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </p>
                <p className="event-detail-row event-location">
                  <EventLocationIcon />
                  <InlineField
                    id="event-location"
                    aria-label="Location"
                    placeholder="Add a location"
                    maxLength={300}
                    value={location}
                    disabled={busy}
                    onChange={(change) =>
                      changed(setLocation)(oneLine(change.target.value))
                    }
                  />
                </p>
                {hosts.length > 0 && (
                  <EventHostRow hosts={hosts} linked={false} />
                )}
                <p className="event-description">
                  <InlineField
                    id="event-description"
                    aria-label="Description"
                    placeholder="Add a description"
                    multiline
                    maxLength={4000}
                    value={description}
                    disabled={busy}
                    onChange={(change) =>
                      changed(setDescription)(change.target.value)
                    }
                  />
                </p>
              </div>
            </div>
            <div className="event-details">
              {busy && <PhotoProgress progress={progress} />}
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
              <div className="event-form-actions">
                <button type="button" disabled={busy} onClick={onCancel}>
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? 'Saving…' : event ? 'Save' : 'Create event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
      {appearanceDialog && (
        <EventAppearanceDialog
          id={event?.id}
          kind={appearanceDialog}
          appearance={appearance}
          onPreview={setAppearancePreview}
          onClose={closeAppearance}
          onReloaded={setAppearance}
          onSaved={(saved) => {
            if (
              saved.colorTheme !== appearance.colorTheme ||
              saved.fontPairing !== appearance.fontPairing
            )
              changed(setAppearance)(saved);
            closeAppearance();
          }}
        />
      )}
      {editing && (
        <PostCropEditor
          file={editing.file}
          initial={editing.crop}
          onClose={() => setEditing(null)}
          onApply={(cropped, crop) => {
            setFile(cropped);
            setSource({ file: editing.file, crop });
            setPreview(URL.createObjectURL(cropped));
            setPreviewSize(null);
            setUpload(crypto.randomUUID());
            setError('');
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
