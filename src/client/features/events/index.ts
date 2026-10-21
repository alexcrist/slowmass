import { lazy } from 'react';
export { eventHref } from './navigation';
export const EventsPage = lazy(() =>
  import('./EventsPage').then((module) => ({ default: module.EventsPage })),
);
export const EventRoute = lazy(() =>
  import('./EventPage').then((module) => ({ default: module.EventRoute })),
);

export { EventPreview, type EventPreviewDetails } from './EventPreview';

export const EventForm = lazy(() =>
  import('./EventForm').then((module) => ({ default: module.EventForm })),
);

export const EditEvent = lazy(() =>
  import('./EventForm').then((module) => ({ default: module.EditEvent })),
);
