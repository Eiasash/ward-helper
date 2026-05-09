import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { runV1_40_0_BackfillIfNeeded } from './storage/rounds';
import './styles.css';

// First-run defaults. Currently: pre-seed the email target for the
// known SZMC owner of this PWA so /consult emails just work after
// fresh install. Stored under a separate flag so removing the address
// in Settings later isn't reverted on next reload.
(function bootstrapDefaults() {
  try {
    const FLAG = 'ward-helper.bootstrap.v1';
    if (localStorage.getItem(FLAG)) return;
    if (!localStorage.getItem('ward-helper.emailTo')) {
      localStorage.setItem('ward-helper.emailTo', 'iyasas@szmc.org.il');
    }
    localStorage.setItem(FLAG, '1');
  } catch {
    /* localStorage disabled — nothing to do */
  }
})();

// v1.40.0 morning-rounds-prep backfill — adds default values to legacy
// patient records lacking the new optional fields. Idempotent.
void runV1_40_0_BackfillIfNeeded();

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
ReactDOM.createRoot(root).render(
  <React.StrictMode><App /></React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/ward-helper/sw.js').catch(() => {});
}
