import { useEffect, useState } from 'react';

export type PhotoPhase =
  | 'opening'
  | 'preparing'
  | 'starting'
  | 'uploading'
  | 'processing'
  | 'saving'
  | 'cancelling';
export type PhotoProgressState = { phase: PhotoPhase; percent?: number | null };

const copy: Record<PhotoPhase, [string, string]> = {
  opening: ['Opening photo…', 'Reading the photo on your device.'],
  preparing: [
    'Preparing photo…',
    'Applying your crop and resizing the photo on your device.',
  ],
  starting: [
    'Starting upload…',
    'Saving the details before sending your photo.',
  ],
  uploading: [
    'Uploading photo…',
    'Sending your photo to slowmass. Keep this screen open.',
  ],
  processing: [
    'Processing and saving…',
    'Photo sent. Waiting for slowmass to finish checking and saving it.',
  ],
  saving: ['Saving details…', 'Waiting for confirmation from slowmass.'],
  cancelling: [
    'Cancelling upload…',
    'Waiting for slowmass to confirm cancellation.',
  ],
};

export function PhotoProgress({ progress }: { progress: PhotoProgressState }) {
  return <PhaseProgress key={progress.phase} progress={progress} />;
}

function PhaseProgress({ progress }: { progress: PhotoProgressState }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(timer);
  }, []);
  const [title, detail] = copy[progress.phase];
  return (
    <div className="photo-progress">
      <div role="status" aria-atomic="true">
        <p className="photo-progress-title">{title}</p>
        <p className="status-copy">{detail}</p>
        {slow && (
          <p className="status-copy">
            This is taking longer than usual. You can retry if it doesn’t
            finish.
          </p>
        )}
      </div>
      {progress.phase === 'uploading' && progress.percent != null && (
        <div className="photo-progress-transfer">
          <progress
            max={100}
            value={progress.percent}
            aria-label="Photo upload"
          />
          <span aria-hidden="true">{progress.percent}%</span>
        </div>
      )}
    </div>
  );
}
