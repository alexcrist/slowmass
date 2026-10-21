export function eventHref(id: string, view = '') {
  return `#event/${encodeURIComponent(id)}${view ? `/${view}` : ''}`;
}
