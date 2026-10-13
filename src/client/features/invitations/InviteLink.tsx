import { useState } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { OverflowMenu } from '../../ui/OverflowMenu';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

type Link = { id: string; expiresAt: number; available: boolean };
type Copy = { id: string; expiresAt: number; url: string };
export function InviteLink() {
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useApiResource<{ link: Link | null }>('/api/invite-link');
  const [copyId, setCopyId] = useState<string | null>(null);
  const [result, setResult] = useState<(Copy & { available: boolean }) | null>(
    null,
  );
  const [replacement, setReplacement] = useState<{
    id: string;
    expectedId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replaceError, setReplaceError] = useState('');
  const [notice, setNotice] = useState('');
  const current: Link | null | undefined = result ?? data?.link;
  async function copy() {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    setNotice('');
    const id = copyId ?? crypto.randomUUID();
    setCopyId(id);
    try {
      const link = await api<Copy>(
        '/api/invite-link/copy',
        jsonRequest('POST', { id }),
      );
      setResult({ ...link, available: link.expiresAt > Date.now() });
      setCopyId(null);
      try {
        await navigator.clipboard.writeText(link.url);
        setNotice('Link copied.');
      } catch {
        setNotice('Select and copy the link below.');
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not copy invite link. Try again.',
      );
      setResult(null);
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function replace() {
    if (busy || !replacement) return;
    setBusy(true);
    setReplaceError('');
    setError('');
    setNotice('');
    try {
      const link = await api<Copy>(
        '/api/invite-link/replace',
        jsonRequest('POST', replacement),
      );
      setResult({ ...link, available: link.expiresAt > Date.now() });
      setCopyId(null);
      setReplacement(null);
      setNotice('Invite link replaced. Copy the new link to share it.');
    } catch (e) {
      setReplaceError(
        e instanceof Error
          ? e.message
          : 'Could not replace invite link. Try again.',
      );
      setResult(null);
      reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="invite-link-section"
      aria-labelledby="invite-link-heading"
    >
      <div className="invite-link-heading">
        <h2 id="invite-link-heading">Share an invite link</h2>
        {current && (
          <OverflowMenu
            label="Link options"
            disabled={busy || loading || Boolean(replacement)}
            items={[
              {
                label: 'Replace link',
                onSelect: () => {
                  setReplaceError('');
                  setReplacement({
                    id: crypto.randomUUID(),
                    expectedId: current.id,
                  });
                },
              },
            ]}
          />
        )}
      </div>
      <p>
        Send your link to friends or a group chat. Anyone who receives it can
        join after verifying their email. Following each other is optional.
      </p>
      {loading && <p role="status">Loading invite link…</p>}
      {loadError && (
        <p role="alert">
          {loadError} <button onClick={reload}>Retry</button>
        </p>
      )}
      {!loading && !loadError && (
        <>
          <p className="field-help">
            {current?.available ? (
              <>
                Expires{' '}
                <time dateTime={new Date(current.expiresAt).toISOString()}>
                  {new Date(current.expiresAt).toLocaleString()}
                </time>
                .
              </>
            ) : current ? (
              'Copy to get a new seven-day link.'
            ) : (
              'Your link will be valid for 7 days.'
            )}
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={busy || Boolean(replacement)}
            onClick={() => void copy()}
          >
            {busy ? 'Please wait…' : 'Copy invite link'}
          </button>
        </>
      )}
      {result && (
        <div className="invite-link-result">
          <label className="field-label" htmlFor="invite-link-url">
            Your invite link
          </label>
          <input
            id="invite-link-url"
            value={result.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {replacement && (
        <ConfirmDialog
          title="Replace invite link"
          confirmLabel="Replace link"
          busy={busy}
          error={replaceError}
          onClose={() => setReplacement(null)}
          onConfirm={() => void replace()}
        >
          <p>
            Your previous link will stop working, including verification emails
            already requested through it. People who already joined keep their
            accounts. You’ll need to send the new link to anyone who hasn’t
            joined yet.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
