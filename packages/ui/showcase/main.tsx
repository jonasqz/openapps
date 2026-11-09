import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
/* Nach Tailwinds Preflight, damit die Tokens gewinnen. */
import '../src/tokens/tokens.css';
import { Showcase } from './Showcase.tsx';

const container = document.getElementById('root');
if (container === null) throw new Error('#root fehlt');
createRoot(container).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
);
