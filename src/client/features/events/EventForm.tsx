import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { useApiResource } from '../../api/useApiResource';
import { PostCropEditor, fullPhoto, type Rectangle } from '../posts';
import { currentTimeZone, fromZoned, zonedInput } from './time';
import type { EventView } from './types';
import {
  originalAppearance,
  type EventAppearance,
} from '../../../shared/event-appearance';
import { EventAppearanceDialog } from './EventAppearanceDialog';
import { useEventAppearance } from './useEventAppearance';

function nextDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export function EditEvent({
  id,
  onSaved,
}: {
  id: string;
  onSaved: (id: string) => void;
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
  return <EventForm key={data.event.id} event={data.event} onSaved={onSaved} />;
}

// New events need a cover photo; hosts can replace it when editing. Times are
// entered in the event's time zone (the creator's, for new events).
export function EventForm({
  event,
  onSaved,
}: {
  event?: EventView;
  onSaved: (id: string) => void;
}) {
  const [appearance, setAppearance] = useState(
    event?.appearance ?? originalAppearance,
  );
  const [appearancePreview, setAppearancePreview] =
    useState<EventAppearance | null>(null);
  const [appearanceDialog, setAppearanceDialog] = useState<
    'color' | 'fonts' | null
  >(null);
  useEventAppearance(event ? (appearancePreview ?? appearance) : undefined);
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
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
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
    if (busy || editing || controller.current) return;
    setError('');
    const startsAt = fromZoned(date, startTime, timeZone);
    if (startsAt === null) {
      setError('Choose a date and start time.');
      return;
    }
    let endsAt = endTime ? fromZoned(date, endTime, timeZone) : null;
    // An end time before the start means the event ends the next day.
    if (endsAt !== null && endsAt <= startsAt)
      endsAt = fromZoned(nextDay(date), endTime, timeZone);
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
      startsAt,
      endsAt,
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
          ...jsonRequest('POST', { id, ...details }),
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
  return (
    <>
      <form className="event-form" onSubmit={(submit) => void save(submit)}>
        <p className="status-copy">
          Anyone with the link can preview the cover photo, title, and date.
          Other details require sign-in.
        </p>
        <label htmlFor="event-photo" className="field-label">
          {event ? 'Replace cover photo' : 'Cover photo'}
        </label>
        <input
          id="event-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(change) => {
            const selected = change.target.files?.[0];
            change.target.value = '';
            if (selected) setEditing({ file: selected, crop: fullPhoto });
          }}
        />
        <p className="field-help">One still JPEG, PNG, or WebP.</p>
        {file && preview && (
          <>
            <img
              className="photo-preview"
              src={preview}
              alt="Selected cover photo preview"
            />
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setEditing(source)}
            >
              Adjust crop
            </button>
          </>
        )}
        {event && (
          <fieldset
            className="event-appearance-controls"
            disabled={busy || Boolean(editing)}
          >
            <legend>Appearance</legend>
            <div className="actions">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setAppearanceDialog('color')}
              >
                Color theme
              </button>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setAppearanceDialog('fonts')}
              >
                Fonts
              </button>
            </div>
          </fieldset>
        )}
        <label htmlFor="event-title" className="field-label">
          Title
        </label>
        <input
          id="event-title"
          required
          maxLength={120}
          value={title}
          disabled={busy}
          onChange={(change) => changed(setTitle)(change.target.value)}
        />
        <label htmlFor="event-date" className="field-label">
          Date
        </label>
        <input
          id="event-date"
          type="date"
          required
          value={date}
          disabled={busy}
          onChange={(change) => changed(setDate)(change.target.value)}
        />
        <div className="event-times">
          <div>
            <label htmlFor="event-start" className="field-label">
              Starts
            </label>
            <input
              id="event-start"
              type="time"
              required
              value={startTime}
              disabled={busy}
              onChange={(change) => changed(setStartTime)(change.target.value)}
            />
          </div>
          <div>
            <label htmlFor="event-end" className="field-label">
              Ends (optional)
            </label>
            <input
              id="event-end"
              type="time"
              value={endTime}
              disabled={busy}
              onChange={(change) => changed(setEndTime)(change.target.value)}
            />
          </div>
        </div>
        <p className="field-help">
          Times are in {event ? 'the event’s' : 'your'} time zone ({timeZone}).
          An end time earlier than the start is the next day.
        </p>
        <label htmlFor="event-location" className="field-label">
          Location
        </label>
        <input
          id="event-location"
          maxLength={300}
          value={location}
          disabled={busy}
          onChange={(change) => changed(setLocation)(change.target.value)}
        />
        <label htmlFor="event-description" className="field-label">
          Description
        </label>
        <textarea
          id="event-description"
          rows={5}
          maxLength={4000}
          value={description}
          disabled={busy}
          onChange={(change) => changed(setDescription)(change.target.value)}
        />
        {busy && <PhotoProgress progress={progress} />}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : event ? 'Save changes' : 'Create event'}
        </button>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </form>
      {event && appearanceDialog && (
        <EventAppearanceDialog
          id={event.id}
          kind={appearanceDialog}
          appearance={appearance}
          onPreview={setAppearancePreview}
          onClose={closeAppearance}
          onReloaded={setAppearance}
          onSaved={(saved) => {
            setAppearance(saved);
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
            setUpload(crypto.randomUUID());
            setError('');
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
