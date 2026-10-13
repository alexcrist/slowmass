import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Welcome } from './features/welcome';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);

document.documentElement.dataset.appStarted = 'true';
window.dispatchEvent(new Event('slowmass:started'));
