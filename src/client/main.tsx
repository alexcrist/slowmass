import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Welcome } from './features/welcome';
import './styles.css';
import { InstallProvider } from './features/install';
import { observePushWindow } from './features/push';

observePushWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstallProvider>
      <Welcome />
    </InstallProvider>
  </StrictMode>,
);

document.documentElement.dataset.appStarted = 'true';
window.dispatchEvent(new Event('slowmass:started'));
