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
import { ProfileForm, type Profile } from './ProfileForm';
import { ProfilePage } from './ProfilePage';
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
  const { route, backRoute } = useRoute();
  const [page, handle, profileTab] = route.split('/');
  const pageKey =
    page === 'profile' ? route.split('/').slice(0, 2).join('/') : route;
  const [profile, setProfile] = useState(initialProfile);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [pageVersion, setPageVersion] = useState(0);
  const ready = Boolean(profile?.hasAvatar);
  // Everyone joins through an event. Until they add a profile photo, members
  // use only events, Activity and Settings.
  const eventOnly = Boolean(profile && !ready);
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
    if (eventOnly) {
      if (page === 'photo' || page === 'edit')
        return { href: '#settings', label: 'Back to settings' };
      // The event-only app has no feed; its lists start at Events.
      if (page === 'event')
        return toList(backRoute.startsWith('feed') ? 'events' : backRoute);
      return null;
    }
    if (page === 'new-event')
      return { href: '#events', label: 'Back to events' };
    if (page === 'event')
      return profileTab === 'edit'
        ? { href: eventHref(handle ?? ''), label: 'Back to event' }
        : toList(backRoute);
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
    // A new member's name keeps them on the event that brought them here.
    if (!created)
      location.hash = eventOnly ? '#settings' : profileHref(value.handle);
  }
  function photoSaved() {
    setProfile((current) => (current ? { ...current, hasAvatar: 1 } : current));
    setAvatarVersion((version) => version + 1);
    // Adding a photo from the event-only app opens the full app.
    if (eventOnly) location.hash = '#feed';
  }
  function eventPage() {
    return handle ? (
      <EventRoute param={handle} linkProfiles={ready} />
    ) : (
      <p>Event not found.</p>
    );
  }
  function eventOnlyScreen() {
    switch (page) {
      case 'feed':
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
      case 'photo':
        return (
          <>
            <p className="onboarding-intro">
              Add a profile photo to share photos and follow friends on
              slowmass.
            </p>
            <AvatarForm
              handle={profile!.handle}
              onChange={photoSaved}
              onboarding
            />
          </>
        );
      case 'edit':
        return <ProfileForm profile={profile} onSave={saved} nameOnly />;
      case 'settings':
        return (
          <>
            <nav className="settings-links" aria-label="Settings">
              <a className="settings-row" href="#photo">
                Add a profile photo
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
            Hosts and other guests see this name. It doesn’t need to be unique.
          </p>
          <ProfileForm profile={null} onSave={saved} nameOnly />
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
            settings={eventOnly}
            onReselect={reselect}
          />,
          headerSlot,
        )}
      {ready && profile && (
        <MemberNavigation
          page={page}
          profile={profile}
          avatarVersion={avatarVersion}
          unreadCount={unreadCount}
          onReselect={reselect}
        />
      )}
      <PageHistoryProvider key={pageVersion}>
        <section
          key={active ? `${pageKey}:${pageVersion}` : 'onboarding'}
          data-page={active ? page : 'onboarding'}
          className={`member-content ${!active ? 'onboarding' : ['feed', 'profile', 'post'].includes(page) || (page === 'event' && profileTab !== 'edit') ? 'photo-screen' : ''}${eventOnly ? ' event-only' : ''}`}
          aria-labelledby="screen-title"
        >
          {active && back && <BackControl {...back} />}
          <h1
            id="screen-title"
            ref={heading}
            tabIndex={-1}
            className={
              active && !(eventOnly && page === 'photo')
                ? 'visually-hidden'
                : undefined
            }
          >
            {profile === null
              ? 'What’s your name?'
              : !active
                ? 'Add a profile photo'
                : eventOnly && page === 'feed'
                  ? 'Events'
                  : eventOnly && page === 'edit'
                    ? 'Edit name'
                    : titles[page] || 'slowmass'}
          </h1>
          {screen()}
          {!active && (
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
