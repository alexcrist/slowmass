import { useState } from 'react';
import { ImageViewer } from '../../ui/ImageViewer';

export function ProfilePhoto({
  handle,
  version,
}: {
  handle: string;
  version?: number;
}) {
  const [open, setOpen] = useState(false);
  const src = `/media/avatar/${encodeURIComponent(handle)}`;
  return (
    <>
      <button
        type="button"
        className="profile-photo-button"
        aria-label={`Enlarge @${handle}'s profile photo`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <img
          className="avatar"
          src={version === undefined ? src : `${src}?v=${version}`}
          alt=""
          width={96}
          height={96}
        />
      </button>
      {open && (
        <ImageViewer
          title="Profile photo"
          src={`${src}?size=large${version === undefined ? '' : `&v=${version}`}`}
          alt={`@${handle}'s profile photo`}
          width={1600}
          height={1600}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
