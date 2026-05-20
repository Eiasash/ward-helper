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

// PHI bot adapter — dynamic-import-gated on the localStorage flag so the
// module + its imports of crypto/phi and storage/indexed stay out of the
// entry chunk for production users. Required by
// scripts/lib/scenPhiColdUnlock.mjs to satisfy the audit spec §3 PROBE
// TRAP. See src/dev/__phiBotApi.ts for the security profile; the gate
// check there remains as defense-in-depth.
//
// Kickoff deviation: original spec had a static import. The dynamic
// import keeps the ~6 kB gz cost off the cold-start path; production
// users without the flag never load the module at all.
(function maybeAttachPhiBotApi() {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('ward-helper.botApi') !== '1') return;
  } catch {
    return;
  }
  void import('./dev/__phiBotApi')
    .then((m) => m.attachPhiBotApiIfEnabled())
    .catch(() => {
      /* chunk load failed — bot will see the missing-attach signal */
    });
})();

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
ReactDOM.createRoot(root).render(
  <React.StrictMode><App /></React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/ward-helper/sw.js').catch(() => {});
}
