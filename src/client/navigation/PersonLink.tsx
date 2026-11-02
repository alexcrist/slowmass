import type { ReactNode } from 'react';
import { profileHref } from './index';
export function PersonLink({
  handle,
  children,
}: {
  handle: string;
  children?: ReactNode;
}) {
  return (
    <a className="person-link" href={profileHref(handle)}>
      <img
        src={`/media/avatar/${encodeURIComponent(handle)}`}
        width={36}
        height={36}
        alt=""
      />
      <strong>{handle}</strong>
      {children}
    </a>
  );
}
