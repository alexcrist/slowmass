import { useState, useEffect } from 'react';
import { api } from '../../api';
import { PostList } from '../posts/Posts';
type VisibleProfile = {
  handle: string;
  displayName: string;
  bio: string | null;
  hasAvatar: number;
  relationship: 'self' | 'none' | 'pending' | 'accepted';
};
export function ProfilePage({ handle }: { handle: string }) {
  const [profile, setProfile] = useState<VisibleProfile | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ profile: VisibleProfile }>(
      `/api/people/${encodeURIComponent(handle)}`,
      { signal: controller.signal },
    )
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
  }, [handle, version]);
  async function act(action: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      if (action === 'block') {
        location.hash = 'people';
        return;
      }
      setProfile(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update follow.');
    } finally {
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setVersion((v) => v + 1)}>Retry</button>
          </>
        ) : (
          <p role="status">Loading profile…</p>
        )}
      </>
    );
  const self = profile.relationship === 'self',
    action =
      profile.relationship === 'accepted'
        ? 'unfollow'
        : profile.relationship === 'pending'
          ? 'cancel'
          : 'request';
  return (
    <>
      <header className="profile-header">
        <div className="profile-identity">
          {profile.hasAvatar ? (
            <img
              className="avatar"
              src={`/media/avatar/${encodeURIComponent(profile.handle)}`}
              alt=""
              width={96}
              height={96}
            />
          ) : (
            <span className="avatar avatar-placeholder" aria-hidden="true">
              {profile.handle[0]}
            </span>
          )}
          <div>
            <h2>@{profile.handle}</h2>
            <p>{profile.displayName}</p>
          </div>
        </div>
        {profile.bio !== null && profile.bio && (
          <p className="bio">{profile.bio}</p>
        )}
        {self ? (
          <div className="actions">
            <a href="#following">Following</a>
            <a href="#followers">Followers</a>
            <a href="#settings">Settings</a>
          </div>
        ) : (
          <div className="actions">
            <button disabled={busy} onClick={() => void act(action)}>
              {action === 'request'
                ? 'Request to follow'
                : action === 'cancel'
                  ? 'Cancel request'
                  : 'Unfollow'}
            </button>
            <details>
              <summary>More</summary>
              <button disabled={busy} onClick={() => void act('block')}>
                Block account
              </button>
            </details>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </header>
      {profile.bio !== null ? (
        <PostList
          key={`${profile.handle}:${version}`}
          handle={profile.handle}
          grid
        />
      ) : (
        <div className="empty-state">
          <h2>This account is private</h2>
          <p>
            {profile.relationship === 'pending'
              ? 'Your follow request is pending.'
              : 'Request to follow to see their photos and bio.'}
          </p>
        </div>
      )}
    </>
  );
}
