import { lazy } from 'react';

export { useNotificationCount } from './useNotificationCount';
export { observeReadActivity } from './visibility';

export const Notifications = lazy(() =>
  import('./Notifications').then((module) => ({
    default: module.Notifications,
  })),
);
