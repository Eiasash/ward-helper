import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
ReactDOM.createRoot(root).render(
  <React.StrictMode><App /></React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/ward-helper/sw.js').catch(() => {});
}
