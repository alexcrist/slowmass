import { useState } from 'react';
import { Dialog } from './Dialog';

export function ImageViewer({
  title,
  src,
  alt,
  width,
  height,
  onClose,
}: {
  title: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return (
    <Dialog title={title} appearance="image" onClose={onClose}>
      <div className="image-viewer" aria-busy={state === 'loading'}>
        <img
          key={attempt}
          className="image-viewer-photo"
          src={src}
          alt={alt}
          width={width}
          height={height}
          style={{ visibility: state === 'ready' ? 'visible' : 'hidden' }}
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
    </Dialog>
  );
}
