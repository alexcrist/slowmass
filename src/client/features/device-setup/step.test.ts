import { expect, it } from 'vitest';
import { deviceSetupStep, type DeviceFacts } from './step';

const android: DeviceFacts = {
  pending: true,
  pushSubscribed: false,
  mobile: true,
  appleMobile: false,
  running: false,
  installPrompt: false,
  push: 'off',
};
const apple = { ...android, appleMobile: true };

it.each([
  ['iPhone browser', apple, 'home-screen'],
  [
    'iPhone browser with a subscription elsewhere',
    { ...apple, pushSubscribed: true },
    null,
  ],
  [
    'iPhone browser ignores its own unavailable push APIs',
    { ...apple, push: 'unsupported' },
    'home-screen',
  ],
  ['iPhone app, push off', { ...apple, running: true }, 'notifications'],
  ['iPhone app, push on', { ...apple, running: true, push: 'on' }, null],
  [
    'iPhone app, push blocked',
    { ...apple, running: true, push: 'denied' },
    null,
  ],
  [
    'iPhone app never offers installation',
    { ...apple, running: true, push: 'on', installPrompt: true },
    null,
  ],
  [
    'Android push off with install available',
    { ...android, installPrompt: true },
    'notifications',
  ],
  [
    'Android push on with install available',
    { ...android, push: 'on', installPrompt: true },
    'install',
  ],
  [
    'Android push blocked with install available',
    { ...android, push: 'denied', installPrompt: true },
    'install',
  ],
  [
    'Android push unsupported with install available',
    { ...android, push: 'unsupported', installPrompt: true },
    'install',
  ],
  ['Android push on, installed', { ...android, push: 'on' }, null],
  [
    'Android while push state is unknown',
    { ...android, push: 'unknown', installPrompt: true },
    null,
  ],
  ['Android app, push off', { ...android, running: true }, 'notifications'],
  ['answered No', { ...android, pending: false, installPrompt: true }, null],
  ['answered No on iPhone', { ...apple, pending: false }, null],
  ['desktop', { ...android, mobile: false, installPrompt: true }, null],
] as const)('%s', (_, facts, step) => {
  expect(deviceSetupStep(facts)).toBe(step);
});
