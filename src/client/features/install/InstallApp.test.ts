import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { InstallApp, InstallProvider } from './InstallApp';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
async function setup(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
  installed = false,
) {
  const events = new EventTarget();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', {
    userAgent,
    platform,
    maxTouchPoints,
    standalone: installed,
  });
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    matchMedia: () => ({
      matches: installed,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  await act(async () => {
    renderer = create(
      createElement(InstallProvider, { children: createElement(InstallApp) }),
    );
  });
  return events;
}
function promptEvent() {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
  });
}

it.each([
  ['iPhone', 'iPhone', 5],
  ['iPad', 'iPad', 5],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5],
  ['Mozilla/5.0 (Linux; Android 16)', 'Linux armv8l', 5],
] as const)(
  'offers mobile install help and uses only available native prompts (%s)',
  async (agent, platform, touch) => {
    const events = await setup(agent, platform, touch);
    expect(renderer!.root.findAllByType('details')).toHaveLength(1);
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
    const event = promptEvent();
    await act(async () => {
      events.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const button = renderer!.root.findByType('button');
    await act(async () => {
      button.props.onClick();
    });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
    await act(async () => {
      events.dispatchEvent(new Event('appinstalled'));
    });
    expect(renderer!.root.findAllByType('details')).toHaveLength(0);
    expect(renderer!.root.findByType('p').children.join('')).toContain(
      'installed app',
    );
  },
);

it.each([
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 0],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 10],
  ['Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0],
] as const)(
  'hides desktop install UI and suppresses automatic prompts (%s)',
  async (agent, platform, touch) => {
    const events = await setup(agent, platform, touch);
    expect(renderer!.toJSON()).toBeNull();
    const event = promptEvent();
    await act(async () => {
      events.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    expect(renderer!.toJSON()).toBeNull();
    await act(async () => {
      events.dispatchEvent(new Event('appinstalled'));
    });
    expect(renderer!.toJSON()).toBeNull();
    await act(async () => renderer!.unmount());
    const afterUnmount = promptEvent();
    events.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  },
);

it('preserves installed status on mobile without showing installation help', async () => {
  await setup('iPhone', 'iPhone', 5, true);
  expect(renderer!.root.findAllByType('details')).toHaveLength(0);
  expect(renderer!.root.findByType('p').children.join('')).toContain(
    'installed app',
  );
});
