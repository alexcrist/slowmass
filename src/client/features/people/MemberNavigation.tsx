import type { MouseEvent } from 'react';
import { currentRoute, profileHref } from '../../navigation';
import { SettingsIcon } from '../../navigation/SettingsIcon';
import type { Profile } from './ProfileForm';

const activityPath =
  'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z';
const eventsPath =
  'M7 3v4M17 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z';
const destinations = [
  { page: 'feed', label: 'Feed', path: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z' },
  {
    page: 'people',
    label: 'Find',
    path: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  },
  { page: 'compose', label: 'New post', path: 'M12 4v16M4 12h16' },
  { page: 'events', label: 'Events', path: eventsPath },
  // Phones reach Activity from the header; the desktop sidebar keeps it.
  { page: 'notifications', label: 'Activity', path: activityPath },
  {
    page: 'profile',
    label: 'Profile',
  },
] as const;

function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

export function MemberNavigation({
  page,
  profile,
  avatarVersion,
  eventOnly = false,
  unreadCount,
  onReselect,
}: {
  page: string;
  profile: Profile;
  avatarVersion: number;
  eventOnly?: boolean;
  unreadCount: number | null;
  onReselect: () => void;
}) {
  return (
    <nav className="app-navigation" aria-label="Main navigation">
      <a
        className="site-name nav-brand"
        href="#feed"
        aria-label="slowmass home"
      >
        <span className="nav-logo" aria-hidden="true">
          <span>s</span>
          <span className="nav-logo-tail">
            <span className="nav-monogram">m</span>
            <span className="nav-wordmark">lowmass</span>
          </span>
        </span>
      </a>
      <div className="primary-nav">
        {destinations.map((item) => {
          const needsSetup =
            eventOnly && !['events', 'notifications'].includes(item.page);
          const href =
            item.page === 'profile'
              ? profileHref(profile.handle)
              : `#${item.page}`;
          const route = currentRoute();
          const canRefresh =
            !needsSetup &&
            ['feed', 'events', 'notifications', 'profile'].includes(
              item.page,
            ) &&
            (href === `#${route}` ||
              (item.page === 'profile' && route === 'profile'));
          const unread = item.page === 'notifications' ? unreadCount : null;
          const unreadDescription = unread
            ? `${unread >= 100 ? 'More than 99' : unread} unread ${unread === 1 ? 'notification' : 'notifications'}.`
            : '';
          return (
            <a
              className={
                item.page === 'notifications'
                  ? 'nav-link nav-link-desktop'
                  : 'nav-link'
              }
              key={item.page}
              href={href}
              onClick={(event) => {
                if (!canRefresh || !reselects(event)) return;
                event.preventDefault();
                onReselect();
              }}
              aria-label={item.label}
              aria-description={
                [
                  unreadDescription,
                  needsSetup
                    ? 'Set up your username and profile photo to use this feature.'
                    : '',
                  canRefresh ? 'Select again to load the latest updates.' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              aria-current={page === item.page ? 'page' : undefined}
            >
              <span className="nav-icon">
                {item.page === 'profile' && !eventOnly ? (
                  <img
                    className="nav-avatar"
                    src={`/media/avatar/${encodeURIComponent(profile.handle)}?v=${avatarVersion}`}
                    width={24}
                    height={24}
                    alt=""
                  />
                ) : (
                  <>
                    <Icon
                      path={
                        item.page === 'profile'
                          ? 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'
                          : item.path
                      }
                    />
                    {Boolean(unread) && (
                      <span className="nav-badge" aria-hidden="true">
                        {unread! >= 100 ? '99+' : unread}
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="nav-label" aria-hidden="true">
                {item.label}
              </span>
            </a>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <a
          className="nav-link"
          href="#settings"
          aria-label="Settings"
          aria-current={page === 'settings' ? 'page' : undefined}
        >
          <SettingsIcon />
          <span className="nav-label" aria-hidden="true">
            Settings
          </span>
        </a>
      </div>
    </nav>
  );
}

// Plain primary clicks on the current destination reload it in place.
function reselects(event: MouseEvent<HTMLAnchorElement>) {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
// Phone header: Activity, plus Settings for members without a profile page.
export function HeaderActions({
  page,
  unreadCount,
  eventOnly,
  onReselect,
}: {
  page: string;
  unreadCount: number | null;
  eventOnly: boolean;
  onReselect: () => void;
}) {
  const unread = unreadCount ?? 0;
  return (
    <nav className="header-actions" aria-label="Account">
      <a
        className="header-action"
        href="#notifications"
        aria-label="Activity"
        aria-description={
          unread
            ? `${unread >= 100 ? 'More than 99' : unread} unread ${unread === 1 ? 'notification' : 'notifications'}.`
            : undefined
        }
        aria-current={page === 'notifications' ? 'page' : undefined}
        onClick={(event) => {
          if (page !== 'notifications' || !reselects(event)) return;
          event.preventDefault();
          onReselect();
        }}
      >
        <span className="nav-icon">
          <Icon path={activityPath} />
          {unread > 0 && (
            <span className="nav-badge" aria-hidden="true">
              {unread >= 100 ? '99+' : unread}
            </span>
          )}
        </span>
      </a>
      {eventOnly && (
        <a
          className="header-action"
          href="#settings"
          aria-label="Settings"
          aria-current={page === 'settings' ? 'page' : undefined}
        >
          <SettingsIcon />
        </a>
      )}
    </nav>
  );
}
