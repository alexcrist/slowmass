import { useEffect, useRef, useState } from 'react';
import { profileHref, useRoute } from '../../navigation';
import { BackControl } from '../../navigation/BackControl';
import { PageHistoryProvider } from '../../navigation/PageHistory';
import { DeleteAccount } from '../account';
import { Notifications, useNotificationCount } from '../notifications';
import { Compose, PostDetail, PostList } from '../posts';
import { AvatarForm } from '../avatars';
import { InvitationForm } from '../invitations';
import { InstallApp, InstallProvider } from '../install';
import { ProfileForm, type Profile } from './ProfileForm';
import { ProfilePage } from './ProfilePage';
import { Discover } from './Discover';
import { Connections, type Kind } from './Connections';
import { MemberNavigation } from './MemberNavigation';
import { PushSettings } from '../push';
import { DeviceSetupItem, useDeviceSetup } from '../device-setup';

const titles: Record<string, string> = {
  feed: 'Feed',
  people: 'Find people',
  compose: 'New post',
  notifications: 'Activity',
  profile: 'Profile',
  post: 'Post',
  settings: 'Settings',
  edit: 'Edit profile',
  invitations: 'Invite friends',
  following: 'Following',
  followers: 'Followers',
  blocked: 'Blocked accounts',
};
type DeviceSetupState = { pending: boolean; pushSubscribed: boolean };
const noDeviceSetup: DeviceSetupState = {
  pending: false,
  pushSubscribed: false,
};
export function MemberApp(props: {
  initialProfile: Profile | null;
  deviceSetup?: DeviceSetupState;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <InstallProvider>
      <MemberPages {...props} />
    </InstallProvider>
  );
}
function MemberPages({
  initialProfile,
  deviceSetup: initialDeviceSetup = noDeviceSetup,
  onSignOut,
  signingOut,
}: {
  initialProfile: Profile | null;
  deviceSetup?: DeviceSetupState;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const { route, backRoute } = useRoute();
  const [page, handle, profileTab] = route.split('/');
  const pageKey =
    page === 'profile' ? route.split('/').slice(0, 2).join('/') : route;
  const [profile, setProfile] = useState(initialProfile);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [pageVersion, setPageVersion] = useState(0);
  const ready = Boolean(profile?.hasAvatar);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) heading.current?.focus();
    wasReady.current = ready;
  }, [ready]);
  const notifications = useNotificationCount(ready);
  const deviceSetup = useDeviceSetup(initialDeviceSetup, ready);
  // The device-setup row counts once per step until seen on this device.
  const unreadCount =
    notifications.count === null
      ? null
      : notifications.count + (deviceSetup.unseen ? 1 : 0);
  const profileRoute = profile ? profileHref(profile.handle) : '#profile';
  const back =
    page === 'settings' || page === 'following' || page === 'followers'
      ? { href: profileRoute, label: 'Back to profile' }
      : page === 'invitations' && backRoute.startsWith('profile')
        ? { href: `#${backRoute}`, label: 'Back to profile' }
        : ['edit', 'invitations', 'blocked'].includes(page)
          ? { href: '#settings', label: 'Back to settings' }
          : page === 'post' ||
              (page === 'profile' && handle && handle !== profile?.handle)
            ? {
                href: `#${backRoute}`,
                label: `Back to ${(titles[backRoute.split('/')[0]] || 'Feed').toLowerCase()}`,
              }
            : null;
  function saved(value: Profile) {
    setProfile(value);
    location.hash = profileHref(value.handle);
  }
  function photoSaved() {
    setProfile((current) => (current ? { ...current, hasAvatar: 1 } : current));
    setAvatarVersion((version) => version + 1);
  }
  function screen() {
    if (!profile)
      return (
        <>
          <p className="onboarding-intro">
            Choose a username and name, then add a profile photo.
          </p>
          <ProfileForm profile={null} onSave={saved} />
        </>
      );
    if (!profile.hasAvatar)
      return (
        <>
          <p className="onboarding-intro">
            Choose a photo, then crop it to fit. You can change it later.
          </p>
          <AvatarForm
            handle={profile.handle}
            onChange={photoSaved}
            onboarding
          />
        </>
      );
    switch (page) {
      case 'feed':
        return <PostList />;
      case 'post':
        return handle ? <PostDetail id={handle} /> : <p>Post not found.</p>;
      case 'people':
        return <Discover />;
      case 'profile':
        return (
          <ProfilePage handle={handle || profile.handle} tab={profileTab} />
        );
      case 'compose':
        return (
          <Compose
            onPublished={() => {
              location.hash = profileRoute;
            }}
          />
        );
      case 'notifications':
        return (
          <Notifications
            onChange={notifications.refresh}
            focus={handle}
            leading={<DeviceSetupItem setup={deviceSetup} />}
          />
        );
      case 'edit':
        return (
          <>
            <AvatarForm handle={profile.handle} onChange={photoSaved} />
            <ProfileForm profile={profile} onSave={saved} />
          </>
        );
      case 'invitations':
        return <InvitationForm />;
      case 'following':
      case 'followers':
      case 'blocked':
        return <Connections kind={page as Kind} />;
      case 'settings':
        return (
          <>
            <nav className="settings-links" aria-label="Settings">
              <a className="settings-row" href="#edit">
                Edit profile
              </a>
              <a className="settings-row" href="#invitations">
                Invite friends
              </a>
              <a className="settings-row" href="#blocked">
                Blocked accounts
              </a>
            </nav>
            <InstallApp />
            <PushSettings />
            <button
              type="button"
              className="settings-row"
              onClick={() => location.reload()}
              disabled={signingOut}
            >
              Reload app
            </button>
            <button
              type="button"
              className="settings-row"
              onClick={onSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            <details className="settings-disclosure">
              <summary className="settings-row settings-danger">
                Delete account
              </summary>
              <div className="settings-details">
                <DeleteAccount />
              </div>
            </details>
          </>
        );
      default:
        return (
          <>
            <p>Page not found.</p>
            <a href="#feed">Return to feed</a>
          </>
        );
    }
  }
  return (
    <>
      {ready && profile && (
        <MemberNavigation
          page={page}
          profile={profile}
          avatarVersion={avatarVersion}
          unreadCount={unreadCount}
          onReselect={() => {
            notifications.refresh();
            setPageVersion((version) => version + 1);
            window.scrollTo(0, 0);
          }}
        />
      )}
      <PageHistoryProvider key={pageVersion}>
        <section
          key={ready ? `${pageKey}:${pageVersion}` : 'onboarding'}
          data-page={ready ? page : 'onboarding'}
          className={`member-content ${!ready ? 'onboarding' : ['feed', 'profile', 'post'].includes(page) ? 'photo-screen' : ''}`}
          aria-labelledby="screen-title"
        >
          {ready && back && <BackControl {...back} />}
          <h1
            id="screen-title"
            ref={heading}
            tabIndex={-1}
            className={ready ? 'visually-hidden' : undefined}
          >
            {profile === null
              ? 'Create your profile'
              : !ready
                ? 'Add a profile photo'
                : titles[page] || 'slowmass'}
          </h1>
          {screen()}
          {!ready && (
            <button
              type="button"
              className="text-button onboarding-switch"
              onClick={onSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Use a different account'}
            </button>
          )}
        </section>
      </PageHistoryProvider>
    </>
  );
}
