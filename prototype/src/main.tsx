import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

if (import.meta.env.DEV) {
  void import('./domain/store').then((m) => Object.assign(window, { __s: m }));
  void import('./demo/Guide').then((m) => Object.assign(window, { __g: m }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
