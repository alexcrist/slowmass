import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Welcome } from './features/welcome/Welcome';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);
