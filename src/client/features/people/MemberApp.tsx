import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { profileHref, useRoute } from '../../navigation';
import { BackControl } from '../../navigation/BackControl';
import { PageHistoryProvider } from '../../navigation/PageHistory';
import { DeleteAccount } from '../account';
import { Notifications, useNotificationCount } from '../notifications';
import { Compose, PostDetail, PostList } from '../posts';
import { AvatarForm } from '../avatars';
import { InstallApp, InstallProvider } from '../install';
import { InviteLinkDialog } from '../invite-links';
import { ProfileForm, type Profile } from './ProfileForm';
import { ProfilePage } from './ProfilePage';
import { ProfileSetup } from './ProfileSetup';
import { Discover } from './Discover';
import { Connections, type Kind } from './Connections';
import { HeaderActions, MemberNavigation } from './MemberNavigation';
import {
  EditEvent,
  EventForm,
  EventRoute,
  EventsPage,
  eventHref,
} from '../events';
import { PushSettings } from '../push';
import { DeviceSetupItem, useDeviceSetup } from '../device-setup';

const titles: Record<string, string> = {
  feed: 'Feed',
  people: 'Find people',
  compose: 'New post',
  notifications: 'Activity',
  events: 'Events',
  'new-event': 'New event',
  event: 'Event',
  photo: 'Add a profile photo',
  profile: 'Profile',
  post: 'Post',
  settings: 'Settings',
  edit: 'Edit profile',
  following: 'Following',
  followers: 'Followers',
  blocked: 'Blocked accounts',
};
type DeviceSetupState = { pending: boolean; pushSubscribed: boolean };
const noDeviceSetup: DeviceSetupState = {
  pending: false,
  pushSubscribed: false,
};
type MemberProps = {
  initialProfile: Profile | null;
  deviceSetup?: DeviceSetupState;
  headerSlot?: HTMLElement | null;
  onSignOut: () => void;
  signingOut: boolean;
};
export function MemberApp(props: MemberProps) {
  return (
    <InstallProvider>
      <MemberPages {...props} />
    </InstallProvider>
  );
}
function MemberPages({
  initialProfile,
  deviceSetup: initialDeviceSetup = noDeviceSetup,
  headerSlot = null,
  onSignOut,
  signingOut,
}: MemberProps) {
  const { route, backRoute, eventRoute, navigate } = useRoute();
  const [page, handle, profileTab] = route.split('/');
  const pageKey =
    page === 'profile' ? route.split('/').slice(0, 2).join('/') : route;
  const [profile, setProfile] = useState(initialProfile);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [pageVersion, setPageVersion] = useState(0);
  const ready = Boolean(profile?.hasAvatar);
  // Until they add a profile photo, members use only events, Activity and
  // Settings.
  const eventOnly = Boolean(profile && !ready);
  const needsPhoto =
    eventOnly &&
    [
      'feed',
      'people',
      'compose',
      'profile',
      'post',
      'following',
      'followers',
      'blocked',
      'new-event',
      'photo',
    ].includes(page);
  const active = ready || eventOnly;
  const heading = useRef<HTMLHeadingElement>(null);
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) heading.current?.focus();
    wasReady.current = ready;
  }, [ready]);
  const notifications = useNotificationCount(active);
  const deviceSetup = useDeviceSetup(initialDeviceSetup, ready);
  // The device-setup row counts once per step until seen on this device.
  const unreadCount =
    notifications.count === null
      ? null
      : notifications.count + (deviceSetup.unseen ? 1 : 0);
  const profileRoute = profile ? profileHref(profile.handle) : '#profile';
  function backLink() {
    const toList = (route: string) => ({
      href: `#${route}`,
      label: `Back to ${(titles[route.split('/')[0]] || 'Feed').toLowerCase()}`,
    });
    // Event pages have no back control: Events is always in the navigation.
    if (eventOnly) {
      if (needsPhoto) return null;
      if (page === 'edit')
        return { href: '#settings', label: 'Back to settings' };
      return null;
    }
    if (page === 'new-event')
      return { href: '#events', label: 'Back to events' };
    if (page === 'event' && profileTab === 'edit')
      return { href: eventHref(handle ?? ''), label: 'Back to event' };
    if (page === 'settings' || page === 'following' || page === 'followers')
      return { href: profileRoute, label: 'Back to profile' };
    if (['edit', 'blocked'].includes(page))
      return { href: '#settings', label: 'Back to settings' };
    if (
      page === 'post' ||
      (page === 'profile' && handle && handle !== profile?.handle)
    )
      return toList(backRoute);
    return null;
  }
  const back = backLink();
  function saved(value: Profile) {
    const created = profile === null;
    setProfile(value);
    // A new member's name keeps them on the event that brought them here;
    // anyone else chooses a username and adds a profile photo next.
    if (created) {
      if (page !== 'event') location.hash = '#photo';
    } else location.hash = eventOnly ? '#settings' : profileHref(value.handle);
  }
  function photoSaved() {
    setProfile((current) => (current ? { ...current, hasAvatar: 1 } : current));
    setAvatarVersion((version) => version + 1);
  }
  function setupFinished(value: Profile) {
    const ownDestination =
      page === 'profile' && (!handle || handle === profile?.handle);
    setProfile(value);
    setAvatarVersion((version) => version + 1);
    // Preserve the requested destination, including an own-profile rename.
    if (ownDestination) navigate(profileHref(value.handle, profileTab));
    else if (page === 'photo') navigate('#feed');
  }
  function eventPage() {
    return handle ? (
      <EventRoute param={handle} linkProfiles={ready} />
    ) : (
      <p>Event not found.</p>
    );
  }
  function eventOnlyScreen() {
    if (needsPhoto && profile)
      return (
        <ProfileSetup
          profile={profile}
          eventRoute={eventRoute}
          startImmediately={page === 'photo'}
          onFinish={setupFinished}
        />
      );
    switch (page) {
      case 'events':
        return (
          <EventsPage
            when={handle === 'past' ? 'past' : 'upcoming'}
            canCreate={false}
          />
        );
      case 'event':
        return eventPage();
      case 'notifications':
        return (
          <Notifications onChange={notifications.refresh} focus={handle} />
        );
      case 'edit':
        return <ProfileForm profile={profile} onSave={saved} mode="name" />;
      case 'settings':
        return (
          <>
            <nav className="settings-links" aria-label="Settings">
              <a className="settings-row" href="#photo">
                Set up profile
              </a>
              <a className="settings-row" href="#edit">
                Edit name
              </a>
            </nav>
            <InstallApp />
            <PushSettings />
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
            <a href="#events">Return to events</a>
          </>
        );
    }
  }
  function screen() {
    if (eventOnly) return eventOnlyScreen();
    if (!profile)
      return (
        <>
          <p className="onboarding-intro">
            {page === 'event'
              ? 'Hosts and other guests see this name.'
              : 'Next, you’ll choose a username and add a profile photo.'}
          </p>
          <ProfileForm profile={null} onSave={saved} mode="name" />
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
      case 'events':
        return (
          <EventsPage
            when={handle === 'past' ? 'past' : 'upcoming'}
            canCreate
          />
        );
      case 'new-event':
        return (
          <EventForm
            onSaved={(id) => {
              location.hash = eventHref(id);
            }}
          />
        );
      case 'event':
        return handle && profileTab === 'edit' ? (
          <EditEvent
            id={handle}
            onSaved={(id) => {
              location.hash = eventHref(id);
            }}
          />
        ) : (
          eventPage()
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
              <a className="settings-row" href="#blocked">
                Blocked accounts
              </a>
            </nav>
            <InviteSettingsRow disabled={signingOut} />
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
  function reselect() {
    notifications.refresh();
    setPageVersion((version) => version + 1);
    window.scrollTo(0, 0);
  }
  return (
    <>
      {active &&
        headerSlot &&
        createPortal(
          <HeaderActions
            page={page}
            unreadCount={unreadCount}
            eventOnly={eventOnly}
            onReselect={reselect}
          />,
          headerSlot,
        )}
      {active && profile && (
        <MemberNavigation
          page={page}
          profile={profile}
          avatarVersion={avatarVersion}
          eventOnly={eventOnly}
          unreadCount={unreadCount}
          onReselect={reselect}
        />
      )}
      <PageHistoryProvider key={pageVersion}>
        <section
          key={active ? `${pageKey}:${pageVersion}` : 'onboarding'}
          data-page={active ? page : 'onboarding'}
          className={`member-content ${!active || needsPhoto ? 'onboarding' : ['feed', 'profile', 'post'].includes(page) || (page === 'event' && profileTab !== 'edit') ? 'photo-screen' : ''}${eventOnly ? ' event-only' : ''}`}
          aria-labelledby="screen-title"
        >
          {active && back && <BackControl {...back} />}
          {!needsPhoto && (
            <h1
              id="screen-title"
              ref={heading}
              tabIndex={-1}
              className={active ? 'visually-hidden' : undefined}
            >
              {profile === null
                ? 'What’s your name?'
                : eventOnly && page === 'edit'
                  ? 'Edit name'
                  : titles[page] || 'slowmass'}
            </h1>
          )}
          {screen()}
        </section>
      </PageHistoryProvider>
    </>
  );
}

function InviteSettingsRow({ disabled }: { disabled: boolean }) {
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <button
        type="button"
        className="settings-row"
        aria-haspopup="dialog"
        onClick={() => setInviting(true)}
        disabled={disabled}
      >
        Invite to slowmass
      </button>
      {inviting && <InviteLinkDialog onClose={() => setInviting(false)} />}
    </>
  );
}
