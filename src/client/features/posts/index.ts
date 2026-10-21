import { lazy } from 'react';
export { PostDetail, PostList } from './Posts';
export const Compose = lazy(() =>
  import('./Compose').then((module) => ({ default: module.Compose })),
);
// Event covers reuse the post photo crop.
export { PostCropEditor } from './PostCropEditor';
export { fullPhoto, type Rectangle } from './crop';
