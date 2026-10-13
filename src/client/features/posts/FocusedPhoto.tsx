import { useEffect, useState, type ReactElement } from 'react';
import { ImageViewer } from '../../ui/ImageViewer';

export function FocusedPhoto({
  src,
  alt,
  width,
  height,
  children,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  children: ReactElement;
}) {
  // Below this breakpoint the photo screen is already edge-to-edge.
  const [canEnlarge, setCanEnlarge] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 900px)');
    const update = () => {
      setCanEnlarge(desktop.matches);
      if (!desktop.matches) setOpen(false);
    };
    update();
    desktop.addEventListener('change', update);
    return () => desktop.removeEventListener('change', update);
  }, []);
  if (!canEnlarge) return children;
  return (
    <>
      <button
        type="button"
        className="post-photo-button"
        aria-label="Enlarge post photo"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <ImageViewer
          title="Post photo"
          src={src}
          alt={alt}
          width={width}
          height={height}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
