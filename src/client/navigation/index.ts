import { useCallback, useEffect, useState } from 'react';
export function postHref(id: string) {
  return `#post/${encodeURIComponent(id)}`;
}
export function profileHref(handle: string, tab = 'posts') {
  return `#profile/${encodeURIComponent(handle)}${tab === 'following' || tab === 'followers' ? `/${tab}` : ''}`;
}
export function currentRoute() {
  const event = /^\/event\/([a-zA-Z0-9]{48})$/.exec(location.pathname);
  const route =
    location.hash.slice(1) || (event ? `event/${event[1]}` : 'feed');
  return route === 'requests' ? 'notifications' : route;
}
// Hash navigation away from a shared event must remove its server path so
// copying or reloading the new destination cannot unfurl the previous event.
export function normalizeEventPath() {
  if (location.pathname?.startsWith('/event/') && location.hash)
    window.history.replaceState(
      window.history.state,
      '',
      `/${location.search}${location.hash}`,
    );
}
export function useRoute() {
  const [routes, setRoutes] = useState(() => [currentRoute()]);
  const change = useCallback(() => {
    normalizeEventPath();
    const next = currentRoute();
    setRoutes((previous) => {
      const current = previous[previous.length - 1];
      if (next === current) return previous;
      // Profile tabs share a page; remember the selected tab when visiting a person.
      if (
        next.startsWith('profile/') &&
        current.startsWith('profile/') &&
        next.split('/')[1] === current.split('/')[1]
      )
        return [...previous.slice(0, -1), next];
      const existing = previous.lastIndexOf(next);
      return existing >= 0
        ? previous.slice(0, existing + 1)
        : [...previous.slice(-49), next];
    });
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    normalizeEventPath();
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('popstate', change);
    };
  }, [change]);
  return {
    navigate(href: string) {
      location.hash = href;
      // Update in the same render as account completion; waiting for the
      // hashchange event could mount a profile under its released username.
      change();
    },
    route: routes[routes.length - 1],
    backRoute: routes[routes.length - 2] ?? 'feed',
    eventRoute: [...routes]
      .reverse()
      .find((route) => /^event\/[^/]+$/.test(route)),
  };
}
