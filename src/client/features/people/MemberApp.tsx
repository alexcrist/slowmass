import { useEffect, useState } from 'react';
import { api } from '../../api';
import { profileHref, useRoute } from '../../navigation';
import { BackControl } from '../../navigation/BackControl';
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
import { MemberNavigation } from './MemberNavigation';

const titles: Record<string, string> = {
  feed: 'Feed',
  people: 'Find people',
  compose: 'New post',
  notifications: 'Activity',
  profile: 'Profile',
  settings: 'Settings',
  edit: 'Edit profile',
  invitations: 'Invite friends',
  following: 'Following',
  followers: 'Followers',
  blocked: 'Blocked accounts',
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
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pageVersion, setPageVersion] = useState(0);
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
  const back =
    page === 'settings' || page === 'following' || page === 'followers'
      ? { href: profileRoute, label: 'Back to profile' }
      : ['edit', 'invitations', 'blocked'].includes(page)
        ? { href: '#settings', label: 'Back to settings' }
        : page === 'profile' && handle && handle !== profile?.handle
          ? { href: '#feed', label: 'Back to feed' }
          : null;
  function saved(value: Profile) {
    setProfile(value);
    location.hash = profileHref(value.handle);
  }
  function screen() {
    if (error)
      return (
        <>
          <p role="alert">{error}</p>
          <button
            onClick={() => {
              setError('');
              setRetry((v) => v + 1);
            }}
          >
            Retry
          </button>
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
        return <Notifications />;
      case 'edit':
        return (
          <>
            <AvatarForm
              handle={profile.handle}
              hasAvatar={Boolean(profile.hasAvatar)}
              onChange={(present) => {
                setProfile((current) =>
                  current
                    ? { ...current, hasAvatar: Number(present) }
                    : current,
                );
                setAvatarVersion((version) => version + 1);
              }}
            />
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
              <a href="#edit">Edit profile</a>
              <a href="#invitations">Invite friends</a>
              <a href="#following">Following</a>
              <a href="#followers">Followers</a>
              <a href="#blocked">Blocked accounts</a>
            </nav>
            <InstallApp />
            <div className="account-tools">
              <button
                className="text-button"
                onClick={() => location.reload()}
                disabled={signingOut}
              >
                Reload app
              </button>
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
      {profile !== undefined && (
        <MemberNavigation
          page={page}
          profile={profile ?? null}
          avatarVersion={avatarVersion}
          onReselect={() => {
            setPageVersion((version) => version + 1);
            window.scrollTo(0, 0);
          }}
        />
      )}
      <section
        key={ready ? `${route}:${pageVersion}` : 'onboarding'}
        data-page={page}
        className={`member-content ${ready && (page === 'feed' || page === 'profile') ? 'photo-screen' : ''}`}
        aria-labelledby="screen-title"
      >
        {ready && back && <BackControl {...back} />}
        <div className="screen-heading">
          <h1 id="screen-title">
            {profile === undefined
              ? 'Slowmass'
              : profile === null
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
