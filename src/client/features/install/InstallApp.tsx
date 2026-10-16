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
  running: boolean;
  prompt: InstallPrompt | null;
  busy: boolean;
  message: string;
  install: () => Promise<void>;
} | null>(null);
export function InstallProvider({ children }: { children: ReactNode }) {
  const existing = useContext(InstallContext);
  return existing ? (
    children
  ) : (
    <InstallStateProvider>{children}</InstallStateProvider>
  );
}
function InstallStateProvider({ children }: { children: ReactNode }) {
  const [mobile] = useState(mobileDevice);
  const [appleMobile] = useState(appleMobileDevice);
  const [installed, setInstalled] = useState(standalone);
  const [running, setRunning] = useState(standalone);
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
    const changed = () => {
      const active = standalone();
      setRunning(active);
      if (active) setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', complete);
    mode.addEventListener('change', changed);
    window.addEventListener('focus', changed);
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', complete);
      mode.removeEventListener('change', changed);
      window.removeEventListener('focus', changed);
    };
  }, [mobile]);
  async function install() {
    if (!mobile || !prompt || busy) return;
    setPrompt(null);
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
        'Use your browser menu to install slowmass. Follow the installation instructions here.',
      );
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }
  return (
    <InstallContext.Provider
      value={{
        mobile,
        appleMobile,
        installed,
        running,
        prompt,
        busy,
        message,
        install,
      }}
    >
      {children}
    </InstallContext.Provider>
  );
}
export function useInstallState() {
  return useContext(InstallContext);
}
function InstallControls() {
  const context = useInstallState();
  if (!context?.mobile) return null;
  const { appleMobile, installed, running, prompt, busy, message, install } =
    context;
  if (running)
    return <p role="status">Installed. You’re using the slowmass app.</p>;
  if (installed)
    return (
      <p role="status">
        Installed.{' '}
        {appleMobile
          ? 'Open the slowmass icon on your Home Screen.'
          : 'Available from your Home Screen.'}
      </p>
    );
  return (
    <div className="install-help">
      <p>
        Add slowmass to your Home Screen. An internet connection is still
        required.
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
      {prompt ? (
        <details>
          <summary>Installation instructions</summary>
          <InstallInstructions appleMobile={appleMobile} />
        </details>
      ) : (
        <InstallInstructions appleMobile={appleMobile} />
      )}
      <p className="status-copy">
        {appleMobile
          ? 'Already added it? Open the slowmass icon on your Home Screen.'
          : 'You can enable notifications here without opening the installed app.'}
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
function InstallInstructions({ appleMobile }: { appleMobile: boolean }) {
  return (
    <>
      {appleMobile ? (
        <p>
          Open your browser’s Share menu (sometimes inside the page menu), then
          choose Add to Home Screen. On iPad, you may need View More or More.
          Keep Open as Web App on if shown, then tap Add.
        </p>
      ) : (
        <p>
          In Chrome, open the three-dot menu → Install and create shortcut →
          Install. Some versions use Add to Home screen. In other browsers, look
          for Install or Add to Home screen.
        </p>
      )}
      <p>
        If these options are missing inside an email or social app, open
        slowmass.com in your regular browser.
      </p>
      {appleMobile && (
        <p>
          After adding it, open the slowmass icon. Your saved profile will be
          there; sign in only if asked.
        </p>
      )}
    </>
  );
}
export function InstallApp() {
  const context = useInstallState();
  if (!context?.mobile) return null;
  return (
    <details className="settings-disclosure">
      <summary className="settings-row">Install slowmass</summary>
      <div className="settings-details">
        <InstallControls />
      </div>
    </details>
  );
}
