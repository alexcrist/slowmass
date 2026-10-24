import { useEffect, useRef, useState } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { PushDevice } from '../push';
import {
  notificationCategories,
  type NotificationCategory,
} from '../../../shared/notification-categories';

type Preference = {
  category: NotificationCategory;
  push: boolean;
  email: boolean;
};
const path = '/api/notifications/preferences';
const groups = [...new Set(notificationCategories.map(({ group }) => group))];

function Choices({ preferences }: { preferences: Preference[] }) {
  const [saved, setSaved] = useState(preferences);
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function change(next: Preference) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(next.category);
    setError('');
    try {
      const { preference } = await api<{ preference: Preference }>(path, {
        ...jsonRequest('PUT', next),
        signal: controller.signal,
      });
      setSaved((current) =>
        current.map((item) =>
          item.category === preference.category ? preference : item,
        ),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not save this setting.',
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setSaving(null);
      }
    }
  }
  return (
    <>
      <table className="notification-choices">
        <thead>
          <tr>
            <th scope="col">Notify me about</th>
            <th scope="col">Push</th>
            <th scope="col">Email</th>
          </tr>
        </thead>
        {groups.map((group) => {
          const rows = notificationCategories.flatMap(
            ({ id, group: of, label }) => {
              const item = saved.find(
                (preference) => preference.category === id,
              );
              return of === group && item ? [{ item, label }] : [];
            },
          );
          if (!rows.length) return null;
          return (
            <tbody key={group}>
              <tr className="notification-group">
                <th scope="rowgroup" colSpan={3}>
                  {group}
                </th>
              </tr>
              {rows.map(({ item, label }) => (
                <tr key={item.category}>
                  <th scope="row">{label}</th>
                  {(['push', 'email'] as const).map((channel) => (
                    <td key={channel}>
                      <input
                        type="checkbox"
                        aria-label={`${channel === 'push' ? 'Push' : 'Email'}: ${label}`}
                        checked={item[channel]}
                        disabled={saving !== null}
                        onChange={(event) =>
                          void change({
                            ...item,
                            [channel]: event.target.checked,
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
      {saving && <p role="status">Saving…</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function NotificationSettings() {
  const { data, error, reload } = useApiResource<{
    preferences: Preference[];
  }>(path);
  return (
    <div className="notification-settings">
      <section aria-labelledby="notification-device">
        <h2 id="notification-device">This device</h2>
        <PushDevice />
      </section>
      <section aria-labelledby="notification-choices">
        <h2 id="notification-choices">Notification types</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={reload}>
              Retry
            </button>
          </>
        ) : data ? (
          <Choices preferences={data.preferences} />
        ) : (
          <p role="status">Loading notification settings…</p>
        )}
      </section>
    </div>
  );
}
