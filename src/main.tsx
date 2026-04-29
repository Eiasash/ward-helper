import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

// Async font load — was a blocking <link> in index.html, cost ~2s of LCP on
// 3G mobile. font-display: swap means the system fallback (Heebo→serif) paints
// first and the webfonts swap in when ready. <noscript> in index.html covers
// the no-JS path.
{
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href =
    'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700&family=Heebo:wght@400;500;700&family=Inter:wght@400;500;700&display=swap';
  document.head.appendChild(fontLink);
}

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
ReactDOM.createRoot(root).render(
  <React.StrictMode><App /></React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/ward-helper/sw.js').catch(() => {});
}
