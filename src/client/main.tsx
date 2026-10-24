import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Welcome } from './features/welcome';
import './styles.css';
import { InstallProvider } from './features/install';
import { observePushWindow } from './features/push';
import { Unsubscribe } from './features/notifications';

observePushWindow();

// Email unsubscribe links work signed out, so they bypass the account shell.
function unsubscribeToken() {
  return /^#unsubscribe\/([A-Za-z0-9._-]{1,200})$/.exec(location.hash)?.[1];
}
function Root() {
  const [token, setToken] = useState(unsubscribeToken);
  useEffect(() => {
    const changed = () => setToken(unsubscribeToken());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return token ? <Unsubscribe token={token} /> : <Welcome />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstallProvider>
      <Root />
    </InstallProvider>
  </StrictMode>,
);

document.documentElement.dataset.appStarted = 'true';
window.dispatchEvent(new Event('slowmass:started'));
