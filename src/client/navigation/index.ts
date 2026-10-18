import { useEffect, useState } from 'react';
export function postHref(id: string) {
  return `#post/${encodeURIComponent(id)}`;
}
export function profileHref(handle: string, tab = 'posts') {
  return `#profile/${encodeURIComponent(handle)}${tab === 'following' || tab === 'followers' ? `/${tab}` : ''}`;
}
export function currentRoute() {
  const route = location.hash.slice(1) || 'feed';
  return route === 'requests' ? 'notifications' : route;
}
export function useRoute() {
  const [routes, setRoutes] = useState(() => [currentRoute()]);
  useEffect(() => {
    const change = () => {
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
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return {
    route: routes[routes.length - 1],
    backRoute: routes[routes.length - 2] ?? 'feed',
    eventRoute: [...routes]
      .reverse()
      .find((route) => /^event\/[^/]+$/.test(route)),
  };
}
