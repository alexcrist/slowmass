import { useEffect, useState } from 'react';
import { jsonRequest } from '../../api';

export type EventPreviewDetails = {
  title: string;
  date: string;
  width: number;
  height: number;
};

// The link stays in the request body. Only this in-memory object URL reaches
// the image element; discard it when leaving the preview or retrying.
export function EventPreview({
  token,
  preview,
}: {
  token: string;
  preview: EventPreviewDetails;
}) {
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
    <div className="event-summary">
      <div
        className="event-photo event-preview-photo"
        style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
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
      </div>
      <div className="event-details">
        <h1 className="event-title">{preview.title}</h1>
        <p className="event-when">{preview.date}</p>
      </div>
    </div>
  );
}
