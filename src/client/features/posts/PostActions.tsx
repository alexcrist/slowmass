import { useId, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { Dialog } from '../../ui/Dialog';
import { OverflowMenu } from '../../ui/OverflowMenu';

export function PostActions({
  id,
  caption,
  onEdited,
  onDeleted,
}: {
  id: string;
  caption: string;
  onEdited: (caption: string) => void;
  onDeleted: () => void;
}) {
  const fieldId = useId();
  const [action, setAction] = useState<'edit' | 'delete' | null>(null);
  const [draft, setDraft] = useState(caption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function select(value: 'edit' | 'delete') {
    setDraft(caption);
    setError('');
    setAction(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'edit') {
        const result = await api<{ caption: string }>(
          `/api/posts/${id}`,
          jsonRequest('PATCH', { caption: draft }),
        );
        onEdited(result.caption);
      } else {
        await api(`/api/posts/${id}`, { method: 'DELETE' });
        onDeleted();
      }
      setAction(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not update this post.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="post-actions">
      <OverflowMenu
        label="Post options"
        disabled={busy}
        items={[
          { label: 'Edit caption', onSelect: () => select('edit') },
          {
            label: 'Delete post',
            danger: true,
            onSelect: () => select('delete'),
          },
        ]}
      />
      {action && (
        <Dialog
          title={action === 'edit' ? 'Edit caption' : 'Delete post'}
          busy={busy}
          onClose={() => setAction(null)}
        >
          <form onSubmit={(event) => void submit(event)}>
            {action === 'edit' ? (
              <>
                <label className="field-label" htmlFor={fieldId}>
                  Caption
                </label>
                <textarea
                  id={fieldId}
                  autoFocus
                  rows={4}
                  maxLength={2000}
                  value={draft}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </>
            ) : (
              <p>Delete this post? This cannot be undone.</p>
            )}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={
                  action === 'delete' ? 'danger-button' : 'primary-button'
                }
                disabled={busy}
              >
                {busy
                  ? 'Saving…'
                  : action === 'edit'
                    ? 'Save caption'
                    : 'Delete post'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
