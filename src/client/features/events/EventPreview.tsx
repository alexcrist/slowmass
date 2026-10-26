import { useEffect, useState, type ReactNode } from 'react';
import { jsonRequest } from '../../api';
import type { EventAppearance } from '../../../shared/event-appearance';
import { useEventAppearance } from './useEventAppearance';

export type EventPreviewDetails = {
  appearance: EventAppearance;
  title: string;
  date: string;
  width: number;
  height: number;
};

// What someone sees before they can see the event's details: its cover,
// title, and date. The caller supplies the cover's contents.
export function EventPreviewSummary({
  title,
  date,
  width,
  height,
  children,
}: {
  title: string;
  date: string;
  width: number;
  height: number;
  children: ReactNode;
}) {
  return (
    <div className="event-summary">
      <div
        className="event-photo event-preview-photo"
        style={{ ['--event-photo-ratio' as string]: `${width} / ${height}` }}
      >
        {children}
      </div>
      <div className="event-details">
        <h1 className="event-title">{title}</h1>
        <p className="event-when">{date}</p>
      </div>
    </div>
  );
}

// The link stays in the request body. Only this in-memory object URL reaches
// the image element; discard it when leaving the preview or retrying.
export function EventPreview({
  token,
  preview,
}: {
  token: string;
  preview: EventPreviewDetails;
}) {
  useEventAppearance(preview.appearance);
  const [photo, setPhoto] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetch('/api/event-link/photo', {
      ...jsonRequest('POST', { token }),
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Preview unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPhoto(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, attempt]);
  return (
    <EventPreviewSummary
      title={preview.title}
      date={preview.date}
      width={preview.width}
      height={preview.height}
    >
      {failed ? (
        <div role="status">
          <p>Couldn’t load the event photo.</p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setPhoto(null);
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Try photo again
          </button>
        </div>
      ) : photo ? (
        <img
          src={photo}
          width={preview.width}
          height={preview.height}
          alt={`Cover photo for ${preview.title}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <p role="status">Loading event photo…</p>
      )}
    </EventPreviewSummary>
  );
}
