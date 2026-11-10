import { useEffect, useRef, useState } from 'react';
import { PHOTO_ACCEPT } from '../../images/decode';
import { AvatarCropDialog, type PreparedAvatar } from './AvatarCropDialog';

// Account setup's photo chooser. Use photo prepares a draft for the parent
// form, which uploads it with the username on Finish.
export function AvatarForm({
  draft,
  onSelect,
  disabled,
}: {
  draft: PreparedAvatar | null;
  onSelect: (photo: PreparedAvatar) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  return (
    <section className="avatar-form" aria-label="Profile photo">
      <h3>Profile photo</h3>
      {preview && (
        <img
          className="avatar"
          src={preview}
          alt="Selected profile photo"
          width={96}
          height={96}
        />
      )}
      <div className="avatar-choose">
        <button
          type="button"
          className="button-link"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {draft ? 'Change photo' : 'Choose profile photo'}
        </button>
        <input
          ref={input}
          id="avatar-file"
          type="file"
          hidden
          disabled={disabled}
          aria-label="Choose profile photo"
          accept={PHOTO_ACCEPT}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (!selected || disabled) return;
            setFile(selected);
            setMessage('');
          }}
        />
      </div>
      {message && <p role="status">{message}</p>}
      {file && (
        <AvatarCropDialog
          file={file}
          onClose={() => setFile(null)}
          onSelect={(photo) => {
            setFile(null);
            setPreview(URL.createObjectURL(photo.blob));
            setMessage('Photo selected. Press Finish to save your account.');
            onSelect(photo);
          }}
        />
      )}
    </section>
  );
}
