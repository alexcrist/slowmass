import type { MouseEvent } from 'react';
import { currentRoute, profileHref } from '../../navigation';
import { SettingsIcon } from '../../navigation/SettingsIcon';
import type { Profile } from './ProfileForm';

const destinations = [
  { page: 'feed', label: 'Feed', path: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z' },
  {
    page: 'people',
    label: 'Find',
    path: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  },
  { page: 'compose', label: 'New post', path: 'M12 4v16M4 12h16' },
  {
    page: 'notifications',
    label: 'Activity',
    path: 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z',
  },
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
  unreadCount,
  onReselect,
  onNavigate,
}: {
  page: string;
  profile: Profile;
  avatarVersion: number;
  unreadCount: number | null;
  onReselect: () => void;
  onNavigate?: () => void;
}) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    )
      onNavigate?.();
  }
  return (
    <nav className="app-navigation" aria-label="Main navigation">
      <a
        className="site-name nav-brand"
        href="#feed"
        aria-label="slowmass home"
        onClick={navigate}
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
          const href =
            item.page === 'profile'
              ? profileHref(profile.handle)
              : `#${item.page}`;
          const route = currentRoute();
          const canRefresh =
            ['feed', 'notifications', 'profile'].includes(item.page) &&
            (href === `#${route}` ||
              (item.page === 'profile' && route === 'profile'));
          const unread = item.page === 'notifications' ? unreadCount : null;
          const unreadDescription = unread
            ? `${unread >= 100 ? 'More than 99' : unread} unread ${unread === 1 ? 'notification' : 'notifications'}.`
            : '';
          return (
            <a
              className="nav-link"
              key={item.page}
              href={href}
              onClick={(event) => {
                navigate(event);
                if (
                  !canRefresh ||
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                onReselect();
              }}
              aria-label={item.label}
              aria-description={
                [
                  unreadDescription,
                  canRefresh ? 'Select again to load the latest updates.' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              aria-current={page === item.page ? 'page' : undefined}
            >
              {item.page === 'profile' ? (
                <img
                  className="nav-avatar"
                  src={`/media/avatar/${encodeURIComponent(profile.handle)}?v=${avatarVersion}`}
                  width={24}
                  height={24}
                  alt=""
                />
              ) : (
                <span className="nav-icon">
                  <Icon path={item.path} />
                  {Boolean(unread) && (
                    <span className="nav-badge" aria-hidden="true">
                      {unread! >= 100 ? '99+' : unread}
                    </span>
                  )}
                </span>
              )}
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
          onClick={navigate}
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
