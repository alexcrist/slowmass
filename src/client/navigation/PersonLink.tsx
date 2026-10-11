import { profileHref } from './index';
export function PersonLink({
  handle,
  hasAvatar,
}: {
  handle: string;
  hasAvatar: number;
}) {
  return (
    <a className="person-link" href={profileHref(handle)}>
      {hasAvatar ? (
        <img
          src={`/media/avatar/${encodeURIComponent(handle)}`}
          width={36}
          height={36}
          alt=""
        />
      ) : (
        <span className="small-avatar" aria-hidden="true">
          {handle[0]}
        </span>
      )}
      <strong>@{handle}</strong>
    </a>
  );
}
