export type Step = 'home-screen' | 'notifications' | 'install';
export const steps: Step[] = ['home-screen', 'notifications', 'install'];
export type PushState = 'unknown' | 'unsupported' | 'denied' | 'off' | 'on';
export type DeviceFacts = {
  // The member has not answered No (server).
  pending: boolean;
  // The member has a live push subscription on some device (server).
  pushSubscribed: boolean;
  mobile: boolean;
  appleMobile: boolean;
  // Running as an installed Home Screen app.
  running: boolean;
  // The browser currently offers its native install prompt.
  installPrompt: boolean;
  // This device's local permission/subscription state.
  push: PushState;
};

// One suggestion at a time. iPhone/iPad must open a Home Screen app before push;
// Android offers push first, then installation while the browser can prompt.
export function deviceSetupStep(facts: DeviceFacts): Step | null {
  if (!facts.pending || !facts.mobile) return null;
  // A browser tab cannot tell whether this iPhone already has the Home Screen
  // app; a live subscription anywhere means the member already finished.
  if (facts.appleMobile && !facts.running)
    return facts.pushSubscribed ? null : 'home-screen';
  if (facts.push === 'unknown') return null;
  if (facts.push === 'off') return 'notifications';
  return !facts.appleMobile && facts.installPrompt ? 'install' : null;
}
