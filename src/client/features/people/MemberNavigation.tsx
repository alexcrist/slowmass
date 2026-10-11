import { currentRoute, profileHref } from '../../navigation';
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
    path: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  },
];

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
  onReselect,
}: {
  page: string;
  profile: Profile | null;
  avatarVersion: number;
  onReselect: () => void;
}) {
  return (
    <nav className="app-navigation" aria-label="Main navigation">
      <a
        className="site-name nav-brand"
        href="#feed"
        aria-label="Slowmass home"
      >
        <span className="nav-monogram" aria-hidden="true">
          sm
        </span>
        <span className="nav-wordmark" aria-hidden="true">
          slowmass
        </span>
      </a>
      <div className="primary-nav">
        {destinations.map((item) => {
          const href = profile
            ? item.page === 'profile'
              ? profileHref(profile.handle)
              : `#${item.page}`
            : '#profile';
          const route = currentRoute();
          const canRefresh =
            Boolean(profile) &&
            ['feed', 'notifications', 'profile'].includes(item.page) &&
            (href === `#${route}` ||
              (item.page === 'profile' && route === 'profile'));
          return (
            <a
              className="nav-link"
              key={item.page}
              href={href}
              onClick={(event) => {
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
                canRefresh
                  ? 'Select again to load the latest updates.'
                  : undefined
              }
              aria-current={page === item.page ? 'page' : undefined}
            >
              {item.page === 'profile' && profile?.hasAvatar ? (
                <img
                  className="nav-avatar"
                  src={`/media/avatar/${encodeURIComponent(profile.handle)}?v=${avatarVersion}`}
                  width={24}
                  height={24}
                  alt=""
                />
              ) : (
                <Icon path={item.path} />
              )}
              <span className="nav-label" aria-hidden="true">
                {item.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
