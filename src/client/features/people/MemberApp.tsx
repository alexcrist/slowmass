import { useEffect, useState, type FormEvent } from 'react';
import { Notifications } from '../notifications/Notifications';
import { Compose, PostList } from '../posts/Posts';
import { AvatarForm } from '../avatars/AvatarForm';
import { api, jsonRequest } from '../../api';
import { InvitationForm } from '../invitations/InvitationForm';

type Profile = {
  handle: string;
  displayName: string;
  bio: string;
  hasAvatar: number;
};
type VisibleProfile = {
  hasAvatar: number;
  handle: string;
  displayName: string;
  bio: string | null;
  relationship: 'self' | 'none' | 'pending' | 'accepted';
};
type Kind = 'requests' | 'following' | 'followers' | 'blocked';
type Tab =
  | 'notifications'
  | 'feed'
  | 'photos'
  | 'compose'
  | 'profile'
  | 'people'
  | 'invitations'
  | Kind;
const titles: Record<Tab, string> = {
  notifications: 'Notifications',
  feed: 'Feed',
  photos: 'My photos',
  compose: 'New photo',
  profile: 'Profile',
  people: 'Find a person',
  requests: 'Follow requests',
  following: 'Following',
  followers: 'Followers',
  blocked: 'Blocked accounts',
  invitations: 'Invitations',
};

export function MemberApp() {
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<Profile | null | undefined>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ profile: Profile | null }>('/api/people/self', {
      signal: controller.signal,
    })
      .then((result) => {
        setProfile(result.profile);
        setError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <>
      <nav className="tabs" aria-label="Account">
        {(Object.keys(titles) as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {titles[item]}
          </button>
        ))}
      </nav>
      <h2>{titles[tab]}</h2>
      {tab === 'invitations' ? (
        <InvitationForm />
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry(retry + 1)}>Retry</button>
        </div>
      ) : profile === undefined ? (
        <p role="status">Loading profile…</p>
      ) : tab === 'profile' ? (
        <>
          <ProfileForm
            key={profile?.handle ?? 'new'}
            profile={profile}
            onSave={setProfile}
          />
          {profile && (
            <AvatarForm
              key={profile.handle}
              handle={profile.handle}
              hasAvatar={Boolean(profile.hasAvatar)}
            />
          )}
        </>
      ) : !profile ? (
        <p>Create your profile before finding or following people.</p>
      ) : tab === 'feed' || tab === 'photos' ? (
        <PostList
          key={tab}
          handle={tab === 'photos' ? profile.handle : undefined}
        />
      ) : tab === 'notifications' ? (
        <Notifications />
      ) : tab === 'compose' ? (
        <Compose onPublished={() => setTab('photos')} />
      ) : tab === 'people' ? (
        <PersonSearch />
      ) : (
        <Connections key={tab} kind={tab} />
      )}
    </>
  );
}

function ProfileForm({
  profile,
  onSave,
}: {
  profile: Profile | null;
  onSave: (profile: Profile) => void;
}) {
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ profile: Profile }>(
        '/api/people/self',
        jsonRequest('PUT', { handle, displayName, bio }),
      );
      onSave(result.profile);
      setMessage('Profile saved.');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save profile.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)}>
      {!profile && (
        <p className="status-copy">
          Choose a handle and display name. Your bio is visible only to accepted
          followers.
        </p>
      )}
      <label className="field-label" htmlFor="handle">
        Handle
      </label>
      <input
        id="handle"
        value={handle}
        onChange={(event) => setHandle(event.target.value.toLowerCase())}
        pattern="[a-z0-9_]{3,30}"
        minLength={3}
        maxLength={30}
        required
        disabled={busy || Boolean(profile)}
        autoCapitalize="none"
        autoComplete="username"
        aria-describedby="handle-help"
      />
      <p id="handle-help" className="field-help">
        3–30 letters, numbers, or underscores. Handles cannot be changed yet.
      </p>
      <label className="field-label" htmlFor="display-name">
        Display name
      </label>
      <input
        id="display-name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        required
        maxLength={60}
        disabled={busy}
        autoComplete="name"
      />
      <label className="field-label" htmlFor="bio">
        Bio
      </label>
      <textarea
        id="bio"
        value={bio}
        onChange={(event) => setBio(event.target.value)}
        maxLength={500}
        rows={4}
        disabled={busy}
      />
      <button className="primary-button" disabled={busy}>
        {busy ? 'Saving…' : profile ? 'Save profile' : 'Create profile'}
      </button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </form>
  );
}

function PersonSearch() {
  const [handle, setHandle] = useState('');
  const [profile, setProfile] = useState<VisibleProfile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProfile(null);
    setError('');
    try {
      setProfile(
        (
          await api<{ profile: VisibleProfile }>(
            `/api/people/${encodeURIComponent(handle.trim().toLowerCase())}`,
          )
        ).profile,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Lookup failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form onSubmit={(event) => void search(event)}>
        <label htmlFor="find-handle" className="field-label">
          Exact handle
        </label>
        <input
          id="find-handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          required
          maxLength={30}
          autoCapitalize="none"
        />
        <button className="primary-button" disabled={busy}>
          {busy ? 'Looking up…' : 'Find person'}
        </button>
      </form>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {profile && <Person key={profile.handle} initial={profile} />}
    </>
  );
}
function Person({ initial }: { initial: VisibleProfile }) {
  const [profile, setProfile] = useState<VisibleProfile | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(action: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(initial.handle)}/${action}`, {
        method: 'POST',
      });
      if (action === 'block') setProfile(null);
      else
        setProfile(
          (
            await api<{ profile: VisibleProfile }>(
              `/api/people/${encodeURIComponent(initial.handle)}`,
            )
          ).profile,
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <p role="status">
        Account blocked. Manage blocked accounts from the account navigation.
      </p>
    );
  const action =
    profile.relationship === 'accepted'
      ? 'unfollow'
      : profile.relationship === 'pending'
        ? 'cancel'
        : 'request';
  return (
    <section className="person" aria-label={`Profile of ${profile.handle}`}>
      <h3>
        {profile.displayName} <span className="handle">@{profile.handle}</span>
      </h3>
      {Boolean(profile.hasAvatar) && profile.bio !== null && (
        <img
          className="avatar"
          src={`/media/avatar/${profile.handle}`}
          alt={`${profile.displayName}'s profile photo`}
          width={120}
          height={120}
        />
      )}
      {profile.bio !== null ? (
        <p className="bio">{profile.bio || 'No bio.'}</p>
      ) : (
        <p>This profile is private.</p>
      )}
      {profile.bio !== null && <PostList handle={profile.handle} />}
      {profile.relationship === 'pending' && (
        <p role="status">Follow request pending.</p>
      )}
      {profile.relationship !== 'self' && (
        <div className="actions">
          <button disabled={busy} onClick={() => void act(action)}>
            {action === 'unfollow'
              ? 'Unfollow'
              : action === 'cancel'
                ? 'Cancel request'
                : 'Request to follow'}
          </button>
          <button disabled={busy} onClick={() => void act('block')}>
            Block account
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
function Connections({ kind }: { kind: Kind }) {
  const [pages, setPages] = useState(['']);
  const [data, setData] = useState<{
    items: { handle: string; displayName: string }[];
    next: string | null;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const after = pages[pages.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    api<NonNullable<typeof data>>(
      `/api/people/connections?kind=${kind}&after=${encodeURIComponent(after)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [kind, after, version]);
  async function act(handle: string, action: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      setVersion(version + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }
  const action =
    kind === 'requests'
      ? 'accept'
      : kind === 'following'
        ? 'unfollow'
        : kind === 'followers'
          ? 'remove'
          : 'unblock';
  return (
    <>
      {!data && !error && <p role="status">Loading…</p>}
      {data?.items.length === 0 && <p>No accounts on this page.</p>}
      <ul className="people-list">
        {data?.items.map((person) => (
          <li key={person.handle}>
            <span>
              {person.displayName}{' '}
              <span className="handle">@{person.handle}</span>
            </span>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => void act(person.handle, action)}
              >
                {kind === 'requests'
                  ? 'Accept'
                  : kind === 'following'
                    ? 'Unfollow'
                    : kind === 'followers'
                      ? 'Remove follower'
                      : 'Unblock'}
              </button>
              {kind === 'requests' && (
                <button
                  disabled={busy}
                  onClick={() => void act(person.handle, 'deny')}
                >
                  Deny
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div>
          <p role="alert" className="error-message">
            {error}
          </p>
          <button onClick={() => setVersion(version + 1)}>Retry</button>
        </div>
      )}
      <nav className="actions" aria-label="List pages">
        {pages.length > 1 && (
          <button
            disabled={busy}
            onClick={() => {
              setData(null);
              setPages(pages.slice(0, -1));
            }}
          >
            Previous
          </button>
        )}
        {data?.next && (
          <button
            disabled={busy}
            onClick={() => {
              setData(null);
              setPages([...pages, data.next!]);
            }}
          >
            Next
          </button>
        )}
      </nav>
    </>
  );
}
