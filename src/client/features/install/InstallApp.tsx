import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

type InstallPrompt = Event & {
  prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
function standalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function appleMobileDevice() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
function mobileDevice() {
  // iPadOS can identify as a Mac when requesting desktop websites.
  return /Android/i.test(navigator.userAgent) || appleMobileDevice();
}

const InstallContext = createContext<{
  mobile: boolean;
  appleMobile: boolean;
  installed: boolean;
  prompt: InstallPrompt | null;
  busy: boolean;
  message: string;
  install: () => Promise<void>;
} | null>(null);
export function InstallProvider({ children }: { children: ReactNode }) {
  const [mobile] = useState(mobileDevice);
  const [appleMobile] = useState(appleMobileDevice);
  const [installed, setInstalled] = useState(standalone);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone)');
    const ready = (event: Event) => {
      if (!('prompt' in event) || typeof event.prompt !== 'function') return;
      event.preventDefault();
      if (mobile) setPrompt(event as InstallPrompt);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const changed = () => setInstalled(standalone());
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', complete);
    mode.addEventListener('change', changed);
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', complete);
      mode.removeEventListener('change', changed);
    };
  }, [mobile]);
  async function install() {
    if (!mobile || !prompt || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await prompt.prompt();
      setMessage(
        result.outcome === 'accepted'
          ? 'Installation requested. Look for slowmass on your home screen or in your apps.'
          : 'You can install later using your browser menu.',
      );
    } catch {
      setMessage(
        'Use your browser menu to install slowmass. Instructions are below.',
      );
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }
  return (
    <InstallContext.Provider
      value={{ mobile, appleMobile, installed, prompt, busy, message, install }}
    >
      {children}
    </InstallContext.Provider>
  );
}
export function useInstallState() {
  return useContext(InstallContext);
}
export function InstallApp() {
  const context = useContext(InstallContext);
  if (!context?.mobile) return null;
  const { installed, prompt, busy, message, install } = context;
  if (installed)
    return (
      <p className="settings-row">slowmass is running as an installed app.</p>
    );

  return (
    <details className="settings-disclosure">
      <summary className="settings-row">Install slowmass</summary>
      <div className="settings-details install-help">
        <p>
          Open slowmass.com in your browser, then follow the steps for your
          device. slowmass still needs an internet connection.
        </p>
        {prompt && (
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void install()}
          >
            {busy ? 'Opening install prompt…' : 'Install app'}
          </button>
        )}
        <ul>
          <li>
            <strong>iPhone — Safari:</strong> Tap Share (the square with an up
            arrow), or open the page menu beside the address bar and choose
            Share. Scroll to Add to Home Screen, keep Open as Web App on if
            shown, then tap Add.
          </li>
          <li>
            <strong>iPad — Safari:</strong> Tap Share → View More (or More) →
            Add to Home Screen. Keep Open as Web App on if shown, then tap Add.
          </li>
          <li>
            <strong>Android — Chrome:</strong> Tap the three-dot menu → Install
            and create shortcut → Install. Some versions call this Add to Home
            screen → Install. Confirm the installation when prompted.
          </li>
        </ul>
        <p>
          If you opened slowmass inside an email or social app, open it in your
          regular browser first. After installing, open the slowmass icon. You
          may need to sign in again in the app.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
