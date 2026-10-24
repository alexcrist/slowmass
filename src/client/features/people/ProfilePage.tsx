import { useId, useRef, useState } from 'react';
import { api } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { profileHref } from '../../navigation';
import { PostList } from '../posts';
import { Connections } from './Connections';
import { ProfilePhoto } from '../avatars';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SettingsIcon } from '../../navigation/SettingsIcon';
import { OverflowMenu } from '../../ui/OverflowMenu';
import { MailIcon } from '../../ui/MailIcon';
import { InviteLinkDialog } from '../invite-links';
type VisibleProfile = {
  handle: string;
  displayName: string;
  bio: string | null;
  relationship: 'self' | 'none' | 'pending' | 'accepted';
};
export function ProfilePage({
  handle,
  tab = 'posts',
  onJoin,
}: {
  handle: string;
  tab?: string;
  onJoin?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirming, setConfirming] = useState<'unfollow' | 'block' | null>(
    null,
  );
  const [inviting, setInviting] = useState(false);
  const {
    data,
    error: loadError,
    loading,
    reload,
    refresh,
  } = useApiResource<{ profile: VisibleProfile }>(
    `/api/people/${encodeURIComponent(handle)}`,
  );
  const profile = data?.profile;
  async function act(action: string) {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      setConfirming(null);
      if (action === 'block') {
        location.hash = 'people';
        return;
      }
      if (action === 'request' || action === 'cancel') refresh();
      else reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update follow.');
    } finally {
      setBusy(false);
    }
  }
  const loadingState = (
    <>
      {loadError ? (
        <>
          <p role="alert">{loadError}</p>
          <button onClick={reload}>Retry</button>
        </>
      ) : (
        <p role="status">Loading profile…</p>
      )}
    </>
  );
  const self = profile?.relationship === 'self',
    canViewContent = !onJoin && (self || profile?.relationship === 'accepted'),
    action = profile?.relationship === 'pending' ? 'cancel' : 'request';
  return (
    <>
      {profile ? (
        <>
          <header
            className={`profile-header${canViewContent ? '' : ' profile-header-other'}`}
          >
            <div className="profile-header-row">
              <div className="profile-identity">
                <ProfilePhoto key={profile.handle} handle={profile.handle} />
                <div>
                  <h2>{profile.handle}</h2>
                  <p>{profile.displayName}</p>
                </div>
              </div>
              {self ? (
                <div className="profile-shortcuts">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Share invite link"
                    aria-haspopup="dialog"
                    onClick={() => setInviting(true)}
                  >
                    <MailIcon />
                  </button>
                  <a
                    className="icon-button"
                    href="#settings"
                    aria-label="Settings"
                  >
                    <SettingsIcon />
                  </a>
                </div>
              ) : !onJoin ? (
                <OverflowMenu
                  label="Profile options"
                  disabled={busy || loading}
                  items={[
                    ...(profile.relationship === 'accepted'
                      ? [
                          {
                            label: 'Unfollow',
                            onSelect: () => {
                              setError('');
                              setConfirming('unfollow');
                            },
                          },
                        ]
                      : []),
                    {
                      label: 'Block account',
                      danger: true,
                      onSelect: () => {
                        setError('');
                        setConfirming('block');
                      },
                    },
                  ]}
                />
              ) : null}
            </div>
            {!onJoin && profile.bio !== null && profile.bio && (
              <p className="bio">{profile.bio}</p>
            )}
            {!self && (onJoin || profile.relationship !== 'accepted') && (
              <div className="profile-follow-actions">
                <button
                  className="compact-button"
                  aria-label={
                    action === 'request'
                      ? 'Request to follow'
                      : 'Cancel request'
                  }
                  disabled={busy || loading}
                  aria-busy={busy || loading}
                  onClick={() => (onJoin ? onJoin() : void act(action))}
                >
                  <span>
                    {action === 'request'
                      ? 'Request to follow'
                      : 'Cancel request'}
                  </span>
                </button>
              </div>
            )}
            {error && !confirming && <p role="alert">{error}</p>}
          </header>
          {inviting && <InviteLinkDialog onClose={() => setInviting(false)} />}
          {confirming && (
            <ConfirmDialog
              title={confirming === 'block' ? 'Block account' : 'Unfollow'}
              confirmLabel={
                confirming === 'block' ? 'Block account' : 'Unfollow'
              }
              danger={confirming === 'block'}
              busy={busy}
              error={error}
              onClose={() => {
                setConfirming(null);
                setError('');
              }}
              onConfirm={() => void act(confirming)}
            >
              <p>
                {confirming === 'block'
                  ? `Block ${profile.handle}? Neither of you will be able to see the other's profile or posts. Your follow relationships will be removed.`
                  : `Stop following ${profile.handle}? You will need their approval to follow them again.`}
              </p>
            </ConfirmDialog>
          )}
        </>
      ) : (
        loadingState
      )}
      {canViewContent ||
      (!onJoin &&
        !profile &&
        !loadError &&
        !['following', 'followers'].includes(tab)) ? (
        <div hidden={!profile}>
          <ProfileTabs
            handle={handle}
            tab={tab}
            self={self}
            pending={!profile}
          />
        </div>
      ) : profile ? (
        <div className="empty-state">
          <h2>This account is private</h2>
          <p>
            {profile.relationship === 'pending'
              ? 'Your follow request is pending.'
              : 'Request to follow to see their photos, bio, and connections.'}
          </p>
        </div>
      ) : null}
    </>
  );
}

const tabs = ['posts', 'following', 'followers'] as const;
function ProfileTabs({
  handle,
  tab,
  self,
  pending,
}: {
  handle: string;
  tab: string;
  self: boolean;
  pending: boolean;
}) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = tabs.find((value) => value === tab) ?? 'posts';
  function select(index: number) {
    location.assign(profileHref(handle, tabs[index]));
  }
  return (
    <>
      <div className="profile-tabs" role="tablist" aria-label="Profile content">
        {tabs.map((value, index) => (
          <button
            key={value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            className="profile-tab"
            id={`${id}-${value}`}
            aria-controls={`${id}-panel`}
            aria-selected={selected === value}
            tabIndex={selected === value ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              buttons.current[next]?.focus();
              select(next);
            }}
          >
            {value === 'posts'
              ? 'Posts'
              : value === 'following'
                ? 'Following'
                : 'Followers'}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        className="profile-tab-panel"
        role="tabpanel"
        aria-labelledby={`${id}-${selected}`}
        tabIndex={0}
        data-tab={selected}
      >
        {selected === 'posts' ? (
          <PostList key={handle} handle={handle} grid pending={pending} />
        ) : (
          <Connections
            key={`${handle}/${selected}`}
            kind={selected}
            handle={self ? undefined : handle}
          />
        )}
      </div>
    </>
  );
}
