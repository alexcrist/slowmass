import { useState } from 'react';
import { Dialog } from './Dialog';

type Photo = {
  title: string;
  src: string;
  alt: string;
  width: number;
  height: number;
};

export function ImageViewer({
  onClose,
  ...photo
}: Photo & { onClose: () => void }) {
  return (
    <Dialog title={photo.title} appearance="image" onClose={onClose}>
      <ViewerImage {...photo} />
    </Dialog>
  );
}

export function ViewerImage({
  title,
  src,
  alt,
  width,
  height,
  style,
}: Photo & { style?: React.CSSProperties }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="image-viewer" aria-busy={state === 'loading'}>
      <img
        key={attempt}
        className="image-viewer-photo"
        src={src}
        alt={alt}
        width={width}
        height={height}
        draggable={false}
        style={{
          ...style,
          visibility: state === 'ready' ? 'visible' : 'hidden',
        }}
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
      />
      {state !== 'ready' && (
        <div className="image-viewer-status">
          {state === 'loading' ? (
            <p role="status">{`Loading ${title.toLowerCase()}…`}</p>
          ) : (
            <>
              <p role="alert">{`Could not load this ${title.toLowerCase()}.`}</p>
              <button
                type="button"
                onClick={() => {
                  setState('loading');
                  setAttempt(attempt + 1);
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
