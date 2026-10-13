import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

// Platform-boundary fakes in Node; no browser or visual checks.
function startup(started = false) {
  vi.useFakeTimers();
  const window = new EventTarget();
  const dataset: Record<string, string> = started ? { appStarted: 'true' } : {};
  const reload = vi.fn();
  const button = { type: '', textContent: '', addEventListener: vi.fn() };
  const status = { textContent: 'Starting slowmass…', after: vi.fn() };
  runInNewContext(readFileSync('public/startup.js', 'utf8'), {
    setTimeout,
    clearTimeout,
    window,
    location: { reload },
    document: {
      documentElement: { dataset },
      querySelector: () => status,
      createElement: () => button,
    },
  });
  return { window, dataset, status, button, reload };
}
afterEach(() => vi.useRealTimers());
it('offers reload when the main application script never starts', () => {
  const { status, button, reload } = startup();
  vi.advanceTimersByTime(14_999);
  expect(status.after).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(status.textContent).toContain('could not finish starting');
  expect(button.textContent).toBe('Reload slowmass');
  expect(status.after).toHaveBeenCalledWith(button);
  button.addEventListener.mock.calls[0][1]();
  expect(reload).toHaveBeenCalledOnce();
});
it('clears the independent timer when the application starts', () => {
  const { window, dataset, status } = startup();
  dataset.appStarted = 'true';
  window.dispatchEvent(new Event('slowmass:started'));
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(20_000);
  expect(status.after).not.toHaveBeenCalled();
});
it('does nothing if its script loads after the application', () => {
  const { status } = startup(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(status.after).not.toHaveBeenCalled();
});
