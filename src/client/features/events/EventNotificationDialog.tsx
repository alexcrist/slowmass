import { useId, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { Dialog } from '../../ui/Dialog';

export function EventNotificationDialog({
  id,
  onClose,
  onSent,
}: {
  id: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const label = useId();
  const [body, setBody] = useState('');
  const [messageId, setMessageId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState('');
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !body.trim()) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/events/${id}/notifications`,
        jsonRequest('POST', { id: messageId, body }),
      );
      onSent();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not send the notification.',
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog title="Send notification" busy={busy} onClose={onClose}>
      <p>
        Your message appears in Activity for everyone who RSVP’d and the other
        hosts. Only people with push notifications enabled receive a push alert.
        No email is sent.
      </p>
      <form onSubmit={(event) => void send(event)}>
        <label className="field-label" htmlFor={label}>
          Message
        </label>
        <textarea
          id={label}
          required
          maxLength={2000}
          rows={5}
          value={body}
          disabled={busy}
          onChange={(event) => {
            setBody(event.target.value);
            setMessageId(crypto.randomUUID());
          }}
        />
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !body.trim()}
          >
            {busy ? 'Sending…' : 'Send notification'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
