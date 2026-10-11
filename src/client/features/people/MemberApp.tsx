import { useEffect, useState } from 'react';
import { api } from '../../api';
import { profileHref, useRoute } from '../../navigation';
import { DeleteAccount } from '../account/DeleteAccount';
import { Notifications } from '../notifications/Notifications';
import { Compose, PostList } from '../posts/Posts';
import { AvatarForm } from '../avatars/AvatarForm';
import { InvitationForm } from '../invitations/InvitationForm';
import { InstallApp, InstallProvider } from '../install/InstallApp';
import { ProfileForm, type Profile } from './ProfileForm';
import { ProfilePage } from './ProfilePage';
import { Discover } from './Discover';
import { Connections, type Kind } from './Connections';

const titles: Record<string, string> = {
  feed: 'Feed',
  people: 'Find people',
  compose: 'New photo',
  notifications: 'Activity',
  profile: 'Profile',
  settings: 'Settings',
  edit: 'Edit profile',
  invitations: 'Invite friends',
  requests: 'Follow requests',
  following: 'Following',
  followers: 'Followers',
  blocked: 'Blocked accounts',
};
const paths = {
  feed: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  people: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  compose:
    'M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v13H3V7a1 1 0 0 1 1-1ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  notifications: 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z',
  profile: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
};
export function MemberApp(props: {
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
  onSignOut,
  signingOut,
}: {
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const route = useRoute();
  const [page, handle] = route.split('/');
  const [profile, setProfile] = useState<Profile | null>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ profile: Profile | null }>('/api/people/self', {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setProfile(data.profile);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [retry]);
  const ready = Boolean(profile);
  const profileRoute = profile ? profileHref(profile.handle) : '#profile';
  function saved(value: Profile) {
    setProfile(value);
    location.hash = profileHref(value.handle);
  }
  function screen() {
    if (error)
      return (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((v) => v + 1)}>Retry</button>
          <button className="text-button" onClick={onSignOut}>
            Sign out
          </button>
        </>
      );
    if (profile === undefined)
      return <p role="status">Loading your account…</p>;
    if (!profile)
      return (
        <>
          <p>
            Choose a username and name to finish joining. You and the friend who
            invited you will follow each other automatically.
          </p>
          <ProfileForm profile={null} onSave={saved} />
          <button className="text-button" onClick={onSignOut}>
            Sign out
          </button>
        </>
      );
    switch (page) {
      case 'feed':
        return <PostList />;
      case 'people':
        return <Discover />;
      case 'profile':
        return <ProfilePage handle={handle || profile.handle} />;
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
          <>
            <a className="text-button" href="#requests">
              Follow requests
            </a>
            <Notifications />
          </>
        );
      case 'edit':
        return (
          <>
            <AvatarForm
              handle={profile.handle}
              hasAvatar={Boolean(profile.hasAvatar)}
              onChange={(present) =>
                setProfile((current) =>
                  current
                    ? { ...current, hasAvatar: Number(present) }
                    : current,
                )
              }
            />
            <ProfileForm profile={profile} onSave={saved} />
          </>
        );
      case 'invitations':
        return <InvitationForm />;
      case 'requests':
      case 'following':
      case 'followers':
      case 'blocked':
        return <Connections kind={page as Kind} />;
      case 'settings':
        return (
          <>
            <nav className="settings-links" aria-label="Settings">
              <a href="#edit">Edit profile</a>
              <a href="#invitations">Invite friends</a>
              <a href="#requests">Follow requests</a>
              <a href="#following">Following</a>
              <a href="#followers">Followers</a>
              <a href="#blocked">Blocked accounts</a>
            </nav>
            <InstallApp />
            <div className="account-tools">
              <button
                className="text-button"
                onClick={onSignOut}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
              <details className="danger-zone">
                <summary>Delete account</summary>
                <DeleteAccount />
              </details>
            </div>
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
      <div className="member-toolbar">
        <a href="#settings" aria-label="Settings">
          Settings
        </a>
      </div>
      <nav className="primary-nav" aria-label="Main navigation">
        {(Object.keys(paths) as (keyof typeof paths)[]).map((item) => (
          <a
            key={item}
            href={
              ready
                ? item === 'profile'
                  ? profileRoute
                  : `#${item}`
                : '#profile'
            }
            aria-current={page === item ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={paths[item]} />
            </svg>
            <span>{item === 'people' ? 'Find' : titles[item]}</span>
          </a>
        ))}
      </nav>
      <section
        key={ready ? route : 'onboarding'}
        className={`member-content ${ready && (page === 'feed' || page === 'profile') ? 'photo-screen' : ''}`}
        aria-labelledby="screen-title"
      >
        <div className="screen-heading">
          <h1 id="screen-title">
            {profile === null
              ? 'Create your profile'
              : titles[page] || 'Slowmass'}
          </h1>
          {page === 'feed' && ready && (
            <span className="field-help">Newest first</span>
          )}
        </div>
        {screen()}
      </section>
    </>
  );
}
