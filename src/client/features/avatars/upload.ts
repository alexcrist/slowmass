import { api } from '../../api';
import type { PhotoProgressState } from '../../images/PhotoProgress';
import type { PreparedAvatar } from './AvatarCropDialog';

// Replaces the member's photo. The prepared ID is the idempotency key, so a
// retry with the same payload cannot save a different image.
export function uploadAvatar(
  photo: PreparedAvatar,
  signal: AbortSignal,
  onProgress: (progress: PhotoProgressState) => void,
) {
  return api('/api/avatar', {
    method: 'PUT',
    headers: {
      'Idempotency-Key': photo.id,
      'Content-Type': photo.blob.type,
    },
    body: photo.blob,
    signal,
    onUploadProgress: (percent) => {
      if (!signal.aborted)
        onProgress({
          phase: percent === 100 ? 'processing' : 'uploading',
          percent,
        });
    },
  });
}
