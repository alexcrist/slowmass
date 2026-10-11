import { useEffect, useState } from 'react';
export function profileHref(handle: string) {
  return `#profile/${encodeURIComponent(handle)}`;
}
export function currentRoute() {
  const route = location.hash.slice(1) || 'feed';
  return route === 'requests' ? 'notifications' : route;
}
export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const change = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}
