import { createContext, useContext } from 'react';

// The signed-in member, for controls that show who is acting. `avatar` is an
// authorized media URL, or null before the member adds a profile photo.
export type Viewer = { displayName: string; avatar: string | null };

const ViewerContext = createContext<Viewer | null>(null);

export const ViewerProvider = ViewerContext.Provider;

export function useViewer() {
  return useContext(ViewerContext);
}
