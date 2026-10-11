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

const InstallContext = createContext<{
  installed: boolean;
  prompt: InstallPrompt | null;
  busy: boolean;
  message: string;
  install: () => Promise<void>;
} | null>(null);
export function InstallProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(standalone);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone)');
    const ready = (event: Event) => {
      if (!('prompt' in event) || typeof event.prompt !== 'function') return;
      event.preventDefault();
      setPrompt(event as InstallPrompt);
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
  }, []);
  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await prompt.prompt();
      setMessage(
        result.outcome === 'accepted'
          ? 'Installation requested. Look for Slowmass on your home screen or in your apps.'
          : 'You can install later using your browser menu.',
      );
    } catch {
      setMessage(
        'Use your browser menu to install Slowmass. Instructions are below.',
      );
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }
  return (
    <InstallContext.Provider
      value={{ installed, prompt, busy, message, install }}
    >
      {children}
    </InstallContext.Provider>
  );
}
export function InstallApp() {
  const context = useContext(InstallContext);
  if (!context) return null;
  const { installed, prompt, busy, message, install } = context;
  if (installed) return <p>Slowmass is running as an installed app.</p>;

  return (
    <details className="install-help">
      <summary>Install Slowmass</summary>
      <p>
        Add Slowmass to your home screen. An internet connection is required.
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
          <strong>iPhone / iPad:</strong> Open slowmass.com in Safari. Tap
          Share, then Add to Home Screen. Leave Open as Web App enabled if
          shown.
        </li>
        <li>
          <strong>Android:</strong> Open slowmass.com in Chrome. Use Install app
          above when available, or the browser menu’s Install app / Add to Home
          screen option.
        </li>
        <li>
          <strong>Computer:</strong> Use the install icon in Chrome or Edge’s
          address bar. On supported Macs, Safari offers File → Add to Dock.
        </li>
      </ul>
      <p>
        If you opened Slowmass inside an email or social app, open it in your
        regular browser first. Installation options vary by browser.
      </p>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
