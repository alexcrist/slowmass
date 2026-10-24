import { lazy } from 'react';

export { useNotificationCount } from './useNotificationCount';
export { observeReadActivity } from './visibility';

export const Notifications = lazy(() =>
  import('./Notifications').then((module) => ({
    default: module.Notifications,
  })),
);
export { Unsubscribe } from './Unsubscribe';
export const NotificationSettings = lazy(() =>
  import('./NotificationSettings').then((module) => ({
    default: module.NotificationSettings,
  })),
);
