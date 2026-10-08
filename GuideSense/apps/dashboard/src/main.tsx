import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { colors, radius } from '@guidesense/protocol';
import App from './App';
import './styles.css';
for (const [name, value] of Object.entries(colors))
  document.documentElement.style.setProperty(`--${name}`, value);
document.documentElement.style.setProperty('--radius', `${radius}px`);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
