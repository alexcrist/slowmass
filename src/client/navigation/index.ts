import { useEffect, useState } from 'react';
export function profileHref(handle: string) {
  return `#profile/${encodeURIComponent(handle)}`;
}
export function useRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'feed');
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || 'feed');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}
