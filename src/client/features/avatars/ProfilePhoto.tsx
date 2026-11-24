import { FocusedPhoto } from '../../ui/FocusedPhoto';

export function ProfilePhoto({ handle }: { handle: string }) {
  const src = `/media/avatar/${encodeURIComponent(handle)}`;
  return (
    <FocusedPhoto
      key={handle}
      title="Profile photo"
      triggerLabel={`Enlarge ${handle}'s profile photo`}
      triggerClass="profile-photo-button"
      openingZoom={1}
      src={`${src}?size=large`}
      alt={`${handle}'s profile photo`}
      width={1600}
      height={1600}
    >
      <img className="avatar" src={src} alt="" width={96} height={96} />
    </FocusedPhoto>
  );
}
