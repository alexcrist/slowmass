import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  colorThemes,
  fontPairings,
  type EventAppearance,
} from '../../../shared/event-appearance';
import { api, jsonRequest } from '../../api';
import { Dialog } from '../../ui/Dialog';
import { palettes, pairings } from './appearance';
import type { EventView } from './types';

export function EventAppearanceDialog({
  id,
  kind,
  appearance,
  onPreview,
  onClose,
  onReloaded,
  onSaved,
}: {
  // New events keep selections in the form until creation; existing events
  // save independently with the current appearance as a concurrency guard.
  id?: string;
  kind: 'color' | 'fonts';
  appearance: EventAppearance;
  onPreview: (appearance: EventAppearance) => void;
  onClose: () => void;
  onReloaded: (appearance: EventAppearance) => void;
  onSaved: (appearance: EventAppearance) => void;
}) {
  const [expected, setExpected] = useState(appearance);
  const [draft, setDraft] = useState(appearance);
  const [pending, setPending] = useState<'save' | 'reload' | null>(null);
  const busy = pending !== null;
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
    if (!id) {
      onSaved(draft);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending('save');
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
        setPending(null);
      }
    }
  }
  async function reload() {
    if (!id || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending('reload');
    setError('');
    try {
      const result = await api<{ event: EventView }>(`/api/events/${id}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.event.viewer.isHost || result.event.cancelled)
        throw new Error(
          'Only hosts can edit an event that hasn’t been cancelled.',
        );
      // Reload only appearance, keeping unsaved event details in the form.
      setExpected(result.event.appearance);
      preview(result.event.appearance);
      onReloaded(result.event.appearance);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Appearance could not be loaded. Try again.',
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(null);
      }
    }
  }
  return (
    <Dialog
      title={kind === 'color' ? 'Color theme' : 'Fonts'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(event) => void save(event)}>
        {kind === 'color' ? (
          <fieldset className="appearance-fieldset" disabled={busy}>
            <legend className="visually-hidden">Color theme</legend>
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
        ) : (
          <fieldset className="appearance-fieldset" disabled={busy}>
            <legend className="visually-hidden">Fonts</legend>
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
                  <span className="appearance-font-copy">
                    <strong
                      style={{
                        fontFamily: pairings[id].heading,
                        fontWeight: pairings[id].headingWeight,
                      }}
                    >
                      {pairings[id].name}
                    </strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error && (
          <div>
            <p role="alert" className="error-message">
              {error}
            </p>
            <button type="button" onClick={() => void reload()} disabled={busy}>
              Reload appearance
            </button>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {pending === 'save'
              ? 'Saving…'
              : pending === 'reload'
                ? 'Loading…'
                : kind === 'color'
                  ? 'Save color theme'
                  : 'Save fonts'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
