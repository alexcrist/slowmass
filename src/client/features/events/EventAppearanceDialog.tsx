import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  colorThemes,
  fontPairings,
  type EventAppearance,
} from '../../../shared/event-appearance';
import { api, jsonRequest } from '../../api';
import { Dialog } from '../../ui/Dialog';
import { palettes, pairings } from './appearance';

export function EventAppearanceDialog({
  id,
  appearance,
  onPreview,
  onClose,
  onReload,
  onSaved,
}: {
  id: string;
  appearance: EventAppearance;
  onPreview: (appearance: EventAppearance) => void;
  onClose: () => void;
  onReload: () => void;
  onSaved: (appearance: EventAppearance) => void;
}) {
  const [expected] = useState(appearance);
  const [draft, setDraft] = useState(appearance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function preview(next: EventAppearance) {
    setDraft(next);
    setError('');
    onPreview(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ appearance: EventAppearance }>(
        `/api/events/${id}/appearance`,
        {
          ...jsonRequest('PATCH', { appearance: draft, expected }),
          signal: controller.signal,
          timeoutMs: 30_000,
        },
      );
      if (!controller.signal.aborted) onSaved(result.appearance);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Appearance could not be saved. Try again.',
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Dialog title="Appearance" onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void save(event)}>
        <p className="status-copy">
          Preview colors and fonts. Save to apply them for everyone viewing this
          event.
        </p>
        <fieldset className="appearance-fieldset" disabled={busy}>
          <legend>Colors</legend>
          <div className="appearance-colors">
            {colorThemes.map((id) => {
              const palette = palettes[id];
              return (
                <label key={id} className="appearance-color">
                  <input
                    type="radio"
                    name="event-color"
                    value={id}
                    checked={draft.colorTheme === id}
                    onChange={() => preview({ ...draft, colorTheme: id })}
                  />
                  <span
                    className="appearance-swatch"
                    aria-hidden="true"
                    style={{
                      background: palette.paper,
                      color: palette.detail,
                      borderColor: palette.controlLine,
                    }}
                  >
                    Aa
                  </span>
                  <span>{palette.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="appearance-fieldset" disabled={busy}>
          <legend>Fonts</legend>
          <div className="appearance-fonts">
            {fontPairings.map((id) => (
              <label key={id} className="appearance-font">
                <input
                  type="radio"
                  name="event-font"
                  value={id}
                  checked={draft.fontPairing === id}
                  onChange={() => preview({ ...draft, fontPairing: id })}
                />
                <span>
                  {pairings[id].name}
                  <small>{pairings[id].description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <div>
            <p role="alert" className="error-message">
              {error}
            </p>
            <button type="button" onClick={onReload} disabled={busy}>
              Reload event
            </button>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save appearance'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
