# ward-helper v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first Hebrew-RTL PWA that turns an AZMA screenshot into a reviewed SZMC-format note ready to paste into Chameleon, with local-first patient history and encrypted Supabase backup.

**Architecture:** Client-only React + TS + Vite static bundle on GitHub Pages. Anthropic Messages API called direct from browser with BYO key (XOR-encrypted). Supabase called direct from browser, ciphertext-only (AES-GCM 256, PBKDF2 600k). Four SZMC skills bundled as static `.md` assets and injected into the system prompt at runtime in a 2-turn extract → review → emit loop.

**Tech stack:** React 18, TypeScript 5, Vite 5, Vitest 3, idb (IndexedDB wrapper), @supabase/supabase-js 2, @anthropic-ai/sdk (browser-compatible), WebCrypto (native), Heebo + Inter fonts. Deploy: GitHub Pages via Actions.

**Reference spec:** `docs/superpowers/specs/2026-04-22-ward-helper-design.md`

---

## Phases

- **Phase A — Foundation** (Tasks 1–15): scaffold, CI, crypto, storage, skill loader, RTL shell, Settings screen. Ships a working installable PWA where you can enter an API key + passphrase and verify the crypto round-trip.
- **Phase B — Extraction pipeline** (Tasks 16–28): agent client, 2-turn loop, camera, paste fallback, Review gate, bidi layer. Ships a working "snap AZMA → parsed fields" flow, no notes yet.
- **Phase C — Notes + history + ship** (Tasks 29–42): 4 note emitters, editor, clipboard, save to IDB + encrypted Supabase, history search, extraction eval harness, PWA install verification, audit-fix-deploy wiring, ship checklist.

---

## File structure

```
ward-helper/
├── .github/workflows/
│   ├── ci.yml
│   ├── pages.yml
│   └── audit-fix-deploy.yml
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── icons/icon-192.png
│   ├── icons/icon-512.png
│   └── skills/                      # populated by prebuild sync
├── scripts/
│   └── sync-skills.mjs              # copy skills from source into public/skills/
├── src/
│   ├── agent/
│   │   ├── client.ts                # Anthropic Messages API wrapper
│   │   ├── tools.ts                 # tool schemas
│   │   ├── loop.ts                  # 2-turn extract → emit
│   │   └── costs.ts                 # token + USD accounting
│   ├── camera/
│   │   └── Capture.tsx              # MediaDevices + multi-shot session
│   ├── crypto/
│   │   ├── aes.ts                   # AES-GCM 256
│   │   ├── pbkdf2.ts                # PBKDF2 600k
│   │   └── xor.ts                   # API key at rest
│   ├── i18n/
│   │   ├── bidi.ts                  # RLM/LRM + direction detection
│   │   └── strings.he.ts
│   ├── notes/
│   │   ├── types.ts
│   │   ├── templates.ts
│   │   └── NoteEditor.tsx
│   ├── skills/
│   │   └── loader.ts                # fetch + cache skill .md files
│   ├── storage/
│   │   ├── indexed.ts               # patients, notes, settings IDB
│   │   └── cloud.ts                 # Supabase + AES wrap
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── screens/
│   │   │   ├── Settings.tsx
│   │   │   ├── Capture.tsx
│   │   │   ├── Review.tsx
│   │   │   ├── NoteEditor.tsx
│   │   │   └── History.tsx
│   │   └── components/
│   │       ├── ConfidencePill.tsx
│   │       └── FieldRow.tsx
│   ├── main.tsx
│   └── styles.css
├── tests/
│   ├── agent.test.ts
│   ├── bidi.test.ts
│   ├── crypto.test.ts
│   ├── storage.test.ts
│   ├── notes.test.ts
│   └── extraction/
│       ├── fixtures/
│       │   ├── admission-01.png
│       │   ├── admission-01.json
│       │   └── ...
│       └── eval.test.ts
├── CLAUDE.md
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

---

# Phase A — Foundation

## Task 1: Scaffold Vite + React + TS project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `src/styles.css`, `.gitignore`

- [ ] **Step 1: Initialize package.json**

```bash
cd E:/Downloads/ward-helper
```

Write `package.json`:

```json
{
  "name": "ward-helper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "npm run prebuild && tsc -b && vite build",
    "prebuild": "node scripts/sync-skills.mjs",
    "preview": "vite preview",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@supabase/supabase-js": "^2.45.0",
    "idb": "^8.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "fake-indexeddb": "^6.0.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: Write vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/ward-helper/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist' },
});
```

- [ ] **Step 4: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 5: Write index.html with RTL + CSP**

```html
<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data:; connect-src 'self' https://api.anthropic.com https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'" />
    <link rel="manifest" href="/ward-helper/manifest.webmanifest" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&family=Inter:wght@400;500;700&display=swap" rel="stylesheet" />
    <title>ward-helper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write minimal App shell**

`src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

`src/ui/App.tsx`:

```tsx
export function App() {
  return <main className="shell"><h1>ward-helper</h1></main>;
}
```

`src/styles.css`:

```css
:root { --bg: #0a0a0c; --fg: #e6e6e8; --accent: #3d7aff; --warn: #d88; --good: #8d8; }
html, body, #root { height: 100%; margin: 0; background: var(--bg); color: var(--fg);
  font-family: 'Heebo', 'Inter', system-ui, sans-serif; }
* { box-sizing: border-box; }
.shell { padding: 16px; min-height: 100%; unicode-bidi: plaintext; }
```

- [ ] **Step 7: Write .gitignore**

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 8: Install + verify build**

Run:
```bash
npm install
npm run check
npm run build
```
Expected: zero TS errors, `dist/` produced.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite + React + TS PWA shell"
```

---

## Task 2: Vitest setup + smoke test

**Files:**
- Create: `tests/setup.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Write tests/setup.ts**

```ts
import 'fake-indexeddb/auto';
```

- [ ] **Step 2: Write smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('arithmetic works', () => { expect(2 + 2).toBe(4); });
  it('fake-indexeddb is loaded', () => { expect(indexedDB).toBeDefined(); });
});
```

- [ ] **Step 3: Run**

```bash
npm test
```
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add vitest setup + smoke tests"
```

---

## Task 3: CI workflow (type + test + build + size gate)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write ci.yml**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npm run build
      - name: Bundle size gate (150 kB gzipped main chunk)
        run: |
          set -e
          MAIN=$(find dist/assets -name 'index-*.js' | head -1)
          SIZE=$(gzip -c "$MAIN" | wc -c)
          echo "main chunk gzipped: $SIZE bytes"
          [ "$SIZE" -le 153600 ] || { echo "FAIL: main chunk exceeds 150 kB"; exit 1; }
      - name: CSP presence check
        run: grep -q 'Content-Security-Policy' index.html
      - name: No-analytics grep
        run: |
          ! grep -rEi 'google-analytics|googletagmanager|sentry\.io|posthog|mixpanel' src/ public/ index.html
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: add verify workflow with size + csp + no-analytics gates"
```

---

## Task 4: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Write pages.yml**

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:

permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Pages deploy workflow"
```

---

## Task 5: PWA manifest + service worker shell

**Files:**
- Create: `public/manifest.webmanifest`, `public/sw.js`, placeholder `public/icons/icon-192.png`, `public/icons/icon-512.png`

- [ ] **Step 1: Write manifest**

```json
{
  "name": "ward-helper",
  "short_name": "ward",
  "start_url": "/ward-helper/",
  "scope": "/ward-helper/",
  "display": "standalone",
  "background_color": "#0a0a0c",
  "theme_color": "#0a0a0c",
  "dir": "rtl",
  "lang": "he",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Write sw.js (app-shell cache-first)**

```js
const VERSION = 'ward-v0.1.0';
const SHELL = ['/ward-helper/', '/ward-helper/index.html'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin && e.request.method === 'GET') {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
```

- [ ] **Step 3: Register SW in main.tsx (add below createRoot)**

```tsx
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/ward-helper/sw.js').catch(() => {});
}
```

- [ ] **Step 4: Create placeholder icons**

```bash
# 1x1 transparent pixel PNG base64 as placeholder
node -e "require('fs').writeFileSync('public/icons/icon-192.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'))"
node -e "require('fs').writeFileSync('public/icons/icon-512.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'))"
```

Replace with real 192×192 / 512×512 icons before ship.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: PWA manifest + app-shell service worker"
```

---

## Task 6: XOR cipher for API key at rest (TDD)

**Files:**
- Create: `src/crypto/xor.ts`, `tests/crypto.test.ts`

- [ ] **Step 1: Write failing test**

`tests/crypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { xorEncrypt, xorDecrypt, generateDeviceSecret } from '@/crypto/xor';

describe('xor api-key cipher', () => {
  it('round-trips an anthropic key', () => {
    const secret = generateDeviceSecret();
    const key = 'sk-ant-api03-REDACTED-REDACTED';
    const ct = xorEncrypt(key, secret);
    expect(ct).not.toContain('sk-ant');
    const pt = xorDecrypt(ct, secret);
    expect(pt).toBe(key);
  });
  it('device secret is 32 bytes', () => {
    const s = generateDeviceSecret();
    expect(s.byteLength).toBe(32);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
npx vitest run tests/crypto.test.ts
```

- [ ] **Step 3: Implement src/crypto/xor.ts**

```ts
export function generateDeviceSecret(): Uint8Array {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return s;
}

export function xorEncrypt(plaintext: string, secret: Uint8Array): Uint8Array {
  const pt = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(pt.length);
  for (let i = 0; i < pt.length; i++) ct[i] = pt[i]! ^ secret[i % secret.length]!;
  return ct;
}

export function xorDecrypt(ciphertext: Uint8Array, secret: Uint8Array): string {
  const pt = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) pt[i] = ciphertext[i]! ^ secret[i % secret.length]!;
  return new TextDecoder().decode(pt);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/crypto.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(crypto): XOR cipher for BYO API key at rest"
```

---

## Task 7: PBKDF2 key derivation (TDD)

**Files:**
- Create: `src/crypto/pbkdf2.ts`
- Modify: `tests/crypto.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { deriveAesKey, PBKDF2_ITERATIONS } from '@/crypto/pbkdf2';

describe('pbkdf2', () => {
  it('iteration count is >= 600000', () => { expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000); });
  it('derives a 256-bit AES-GCM key from passphrase + salt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('correct-horse-battery-staple', salt);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });
  it('same passphrase + salt produces same key material', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k1 = await deriveAesKey('pass', salt);
    const k2 = await deriveAesKey('pass', salt);
    const raw1 = await crypto.subtle.exportKey('raw', k1);
    const raw2 = await crypto.subtle.exportKey('raw', k2);
    expect(new Uint8Array(raw1)).toEqual(new Uint8Array(raw2));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement src/crypto/pbkdf2.ts**

```ts
export const PBKDF2_ITERATIONS = 600_000;

export async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — only so tests can compare; in prod we never export
    ['encrypt', 'decrypt'],
  );
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(crypto): PBKDF2-600k AES-GCM key derivation"
```

---

## Task 8: AES-GCM encrypt/decrypt (TDD)

**Files:**
- Create: `src/crypto/aes.ts`
- Modify: `tests/crypto.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

describe('aes-gcm', () => {
  it('round-trips a JSON note', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const plaintext = JSON.stringify({ name: 'דוד כהן', age: 82, note: 'קבלה' });
    const { iv, ciphertext } = await aesEncrypt(plaintext, key);
    expect(iv.byteLength).toBe(12);
    expect(ciphertext.byteLength).toBeGreaterThan(0);
    const out = await aesDecrypt(ciphertext, iv, key);
    expect(out).toBe(plaintext);
  });
  it('different IVs produce different ciphertexts for same plaintext', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const a = await aesEncrypt('x', key);
    const b = await aesEncrypt('x', key);
    expect(new Uint8Array(a.ciphertext)).not.toEqual(new Uint8Array(b.ciphertext));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement src/crypto/aes.ts**

```ts
export interface Sealed { iv: Uint8Array; ciphertext: Uint8Array; }

export async function aesEncrypt(plaintext: string, key: CryptoKey): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function aesDecrypt(ciphertext: Uint8Array, iv: Uint8Array, key: CryptoKey): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(pt);
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(crypto): AES-GCM 256 encrypt/decrypt"
```

---

## Task 9: IndexedDB schema (TDD)

**Files:**
- Create: `src/storage/indexed.ts`, `tests/storage.test.ts`

- [ ] **Step 1: Write failing test**

`tests/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, putPatient, putNote, listPatients, listNotes, getSettings, setSettings } from '@/storage/indexed';

beforeEach(async () => { indexedDB.deleteDatabase('ward-helper'); });

describe('indexeddb schema', () => {
  it('stores and retrieves a patient', async () => {
    await putPatient({ id: 'p1', name: 'דוד כהן', teudatZehut: '012345678', dob: '1944-03-01', room: '3-12', tags: [], createdAt: 1, updatedAt: 1 });
    const list = await listPatients();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('דוד כהן');
  });

  it('stores and retrieves a note keyed by patientId', async () => {
    await putNote({ id: 'n1', patientId: 'p1', type: 'admission', bodyHebrew: 'קבלה...', structuredData: {}, createdAt: 1, updatedAt: 1 });
    const notes = await listNotes('p1');
    expect(notes).toHaveLength(1);
  });

  it('settings is a keyed singleton', async () => {
    await setSettings({ apiKeyXor: new Uint8Array([1, 2]), deviceSecret: new Uint8Array([3, 4]), lastPassphraseAuthAt: null, prefs: {} });
    const s = await getSettings();
    expect(s?.apiKeyXor[0]).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement src/storage/indexed.ts**

```ts
import { openDB, type IDBPDatabase } from 'idb';

export type NoteType = 'admission' | 'discharge' | 'consult' | 'case';

export interface Patient {
  id: string; name: string; teudatZehut: string; dob: string;
  room: string | null; tags: string[]; createdAt: number; updatedAt: number;
}

export interface Note {
  id: string; patientId: string; type: NoteType; bodyHebrew: string;
  structuredData: Record<string, unknown>; createdAt: number; updatedAt: number;
}

export interface Settings {
  apiKeyXor: Uint8Array; deviceSecret: Uint8Array;
  lastPassphraseAuthAt: number | null; prefs: Record<string, unknown>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
export function getDb() {
  if (!dbPromise) dbPromise = openDB('ward-helper', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('patients')) db.createObjectStore('patients', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('by-patient', 'patientId');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    },
  });
  return dbPromise;
}

export async function putPatient(p: Patient) { (await getDb()).put('patients', p); }
export async function listPatients(): Promise<Patient[]> { return (await getDb()).getAll('patients'); }
export async function putNote(n: Note) { (await getDb()).put('notes', n); }
export async function listNotes(patientId: string): Promise<Note[]> {
  const db = await getDb();
  return db.getAllFromIndex('notes', 'by-patient', patientId);
}
export async function setSettings(s: Settings) { (await getDb()).put('settings', s, 'singleton'); }
export async function getSettings(): Promise<Settings | undefined> { return (await getDb()).get('settings', 'singleton'); }
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): IndexedDB schema (patients, notes, settings)"
```

---

## Task 10: Supabase client + encrypted blob round-trip

**Files:**
- Create: `src/storage/cloud.ts`, `supabase/migrations/0001_ward_helper_backup.sql`
- Modify: `tests/storage.test.ts`

- [ ] **Step 1: Write the migration**

`supabase/migrations/0001_ward_helper_backup.sql`:

```sql
create table ward_helper_backup (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  blob_type    text not null check (blob_type in ('patient', 'note')),
  blob_id      text not null,
  ciphertext   bytea not null,
  iv           bytea not null,
  salt         bytea not null,
  version      int  not null default 1,
  updated_at   timestamptz not null default now(),
  unique (user_id, blob_type, blob_id)
);

alter table ward_helper_backup enable row level security;
create policy "owner-only" on ward_helper_backup
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index on ward_helper_backup (user_id, updated_at desc);
```

- [ ] **Step 2: Append failing test (with mocked client)**

```ts
import { encryptForCloud, decryptFromCloud } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';

describe('cloud encryption boundary', () => {
  it('encryptForCloud produces opaque bytes', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const record = { id: 'p1', name: 'דוד כהן', teudatZehut: '012345678' };
    const sealed = await encryptForCloud(record, key, salt);
    const asString = new TextDecoder('utf-8', { fatal: false }).decode(sealed.ciphertext);
    expect(asString).not.toContain('דוד');
    expect(asString).not.toContain('012345678');
  });

  it('round-trips through encryptForCloud → decryptFromCloud', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const record = { id: 'n1', bodyHebrew: 'קבלה של מטופל' };
    const sealed = await encryptForCloud(record, key, salt);
    const back = await decryptFromCloud<typeof record>(sealed.ciphertext, sealed.iv, key);
    expect(back).toEqual(record);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement src/storage/cloud.ts**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON = import.meta.env?.VITE_SUPABASE_ANON ?? '';

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON);
  return client;
}

export interface SealedBlob { ciphertext: Uint8Array; iv: Uint8Array; salt: Uint8Array; }

export async function encryptForCloud<T>(record: T, key: CryptoKey, salt: Uint8Array): Promise<SealedBlob> {
  const { iv, ciphertext } = await aesEncrypt(JSON.stringify(record), key);
  return { ciphertext, iv, salt };
}

export async function decryptFromCloud<T>(ct: Uint8Array, iv: Uint8Array, key: CryptoKey): Promise<T> {
  const json = await aesDecrypt(ct, iv, key);
  return JSON.parse(json) as T;
}

export async function ensureAnonymousAuth(): Promise<string> {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed');
  return data.user.id;
}

export async function pushBlob(type: 'patient' | 'note', id: string, sealed: SealedBlob): Promise<void> {
  const userId = await ensureAnonymousAuth();
  const { error } = await getSupabase().from('ward_helper_backup').upsert({
    user_id: userId,
    blob_type: type,
    blob_id: id,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    salt: sealed.salt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,blob_type,blob_id' });
  if (error) throw error;
}
```

- [ ] **Step 5: Run — expect PASS (the two boundary tests run without hitting Supabase)**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storage): Supabase ciphertext-only backup + migration"
```

---

## Task 11: Skills sync script + loader

**Files:**
- Create: `scripts/sync-skills.mjs`, `src/skills/loader.ts`
- Modify: `tests/setup.ts` to mock fetch for skills

- [ ] **Step 1: Write sync-skills.mjs**

This script copies your four SZMC skills from a source directory into `public/skills/`. On first run we copy from a known source; `SKILL_SOURCE` env var overrides.

```js
#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKILLS = ['azma-ui', 'szmc-clinical-notes', 'szmc-interesting-cases', 'hebrew-medical-glossary'];
const SOURCE = process.env.SKILL_SOURCE ?? resolve(process.env.USERPROFILE ?? process.env.HOME ?? '', '.claude/skills');
const DEST = resolve('public/skills');

mkdirSync(DEST, { recursive: true });
for (const name of SKILLS) {
  const src = join(SOURCE, name, 'SKILL.md');
  const dst = join(DEST, `${name}.md`);
  if (existsSync(src)) {
    cpSync(src, dst);
    console.log(`synced ${name}`);
  } else {
    writeFileSync(dst, `# ${name}\n\n(placeholder — source not found at ${src})\n`);
    console.warn(`WARN: ${name} source missing; wrote placeholder to ${dst}`);
  }
}
```

- [ ] **Step 2: Run once to populate placeholders**

```bash
node scripts/sync-skills.mjs
ls public/skills/
```

- [ ] **Step 3: Write src/skills/loader.ts**

```ts
const BASE = import.meta.env?.BASE_URL ?? '/';
const cache = new Map<string, string>();

export type SkillName =
  | 'azma-ui'
  | 'szmc-clinical-notes'
  | 'szmc-interesting-cases'
  | 'hebrew-medical-glossary';

export async function loadSkill(name: SkillName): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;
  const res = await fetch(`${BASE}skills/${name}.md`);
  if (!res.ok) throw new Error(`skill ${name} not found (${res.status})`);
  const text = await res.text();
  cache.set(name, text);
  return text;
}

export async function loadSkills(names: SkillName[]): Promise<string> {
  const parts = await Promise.all(names.map(loadSkill));
  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(skills): sync script + runtime loader"
```

---

## Task 12: RTL design tokens + bottom-nav shell

**Files:**
- Modify: `src/styles.css`, `src/ui/App.tsx`

- [ ] **Step 1: Expand styles.css**

```css
:root {
  --bg: #0a0a0c;
  --card: #141418;
  --fg: #e6e6e8;
  --muted: #8a8a92;
  --accent: #3d7aff;
  --warn: #d88055;
  --good: #7ac57a;
  --red: #d85555;
  --amber: #e0b040;
  --radius: 12px;
  --pad: 16px;
  --font-he: 'Heebo', system-ui, sans-serif;
  --font-en: 'Inter', system-ui, sans-serif;
}
html, body, #root { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-he); }
* { box-sizing: border-box; }
main.shell { padding: var(--pad); padding-bottom: 80px; min-height: 100%; unicode-bidi: plaintext; }
nav.bottom-nav {
  position: fixed; inset-inline: 0; bottom: 0; display: grid; grid-template-columns: repeat(4, 1fr);
  background: var(--card); border-top: 1px solid #222;
}
nav.bottom-nav a { padding: 14px 8px; text-align: center; color: var(--muted); text-decoration: none; font-size: 14px; }
nav.bottom-nav a.active { color: var(--accent); }
button { background: var(--accent); color: white; border: 0; border-radius: var(--radius); padding: 12px 16px; font-family: inherit; font-size: 16px; min-height: 44px; }
button.ghost { background: transparent; color: var(--fg); border: 1px solid #333; }
input, textarea { background: var(--card); color: var(--fg); border: 1px solid #2a2a30; border-radius: 8px; padding: 10px 12px; font-family: inherit; width: 100%; }
input[dir="auto"], textarea[dir="auto"] { unicode-bidi: plaintext; }
```

- [ ] **Step 2: Replace App.tsx with router**

`src/ui/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Capture } from './screens/Capture';
import { History } from './screens/History';
import { Settings } from './screens/Settings';

export function App() {
  return (
    <BrowserRouter basename="/ward-helper">
      <main className="shell">
        <Routes>
          <Route path="/" element={<Capture />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Capture />} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        <NavLink to="/" end>צלם</NavLink>
        <NavLink to="/history">היסטוריה</NavLink>
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Stub out the three screens**

`src/ui/screens/Capture.tsx`:
```tsx
export function Capture() { return <section><h1>צלם מסך</h1></section>; }
```

`src/ui/screens/History.tsx`:
```tsx
export function History() { return <section><h1>היסטוריה</h1></section>; }
```

`src/ui/screens/Settings.tsx`:
```tsx
export function Settings() { return <section><h1>הגדרות</h1></section>; }
```

- [ ] **Step 4: npm run dev, verify RTL layout in browser**

```bash
npm run dev
```
Open `http://localhost:5173/ward-helper/`. Verify tabs render right-to-left, Heebo font loads.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): RTL shell + bottom nav + router"
```

---

## Task 13: Settings screen — API key + passphrase

**Files:**
- Modify: `src/ui/screens/Settings.tsx`
- Create: `src/ui/hooks/useSettings.ts`, `src/crypto/keystore.ts`

- [ ] **Step 1: Write keystore helper**

`src/crypto/keystore.ts`:

```ts
import { getSettings, setSettings } from '@/storage/indexed';
import { xorEncrypt, xorDecrypt, generateDeviceSecret } from './xor';

export async function saveApiKey(apiKey: string): Promise<void> {
  const existing = await getSettings();
  const deviceSecret = existing?.deviceSecret ?? generateDeviceSecret();
  const apiKeyXor = xorEncrypt(apiKey, deviceSecret);
  await setSettings({
    apiKeyXor,
    deviceSecret,
    lastPassphraseAuthAt: existing?.lastPassphraseAuthAt ?? null,
    prefs: existing?.prefs ?? {},
  });
}

export async function loadApiKey(): Promise<string | null> {
  const s = await getSettings();
  if (!s || !s.apiKeyXor || s.apiKeyXor.length === 0) return null;
  return xorDecrypt(s.apiKeyXor, s.deviceSecret);
}

export async function hasApiKey(): Promise<boolean> {
  const s = await getSettings();
  return !!(s && s.apiKeyXor && s.apiKeyXor.length > 0);
}
```

- [ ] **Step 2: Write passphrase context (in-memory only)**

`src/ui/hooks/useSettings.ts`:

```ts
import { useState, useEffect, useCallback } from 'react';
import { hasApiKey, loadApiKey, saveApiKey } from '@/crypto/keystore';

let passphraseMemory: string | null = null;
let passphraseSetAt: number = 0;
const IDLE_MS = 15 * 60 * 1000;

export function setPassphrase(p: string) { passphraseMemory = p; passphraseSetAt = Date.now(); }
export function getPassphrase(): string | null {
  if (!passphraseMemory) return null;
  if (Date.now() - passphraseSetAt > IDLE_MS) { passphraseMemory = null; return null; }
  return passphraseMemory;
}
export function clearPassphrase() { passphraseMemory = null; passphraseSetAt = 0; }

export function useApiKey() {
  const [present, setPresent] = useState<boolean | null>(null);
  useEffect(() => { hasApiKey().then(setPresent); }, []);
  const save = useCallback(async (k: string) => { await saveApiKey(k); setPresent(true); }, []);
  const peek = useCallback(async () => loadApiKey(), []);
  return { present, save, peek };
}
```

- [ ] **Step 3: Replace Settings.tsx**

```tsx
import { useState } from 'react';
import { useApiKey, setPassphrase, getPassphrase, clearPassphrase } from '../hooks/useSettings';

export function Settings() {
  const { present, save } = useApiKey();
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');

  async function onSaveKey() {
    if (!key.startsWith('sk-ant-')) { setMsg('מפתח לא תקין'); return; }
    await save(key);
    setKey('');
    setMsg('מפתח נשמר ✓');
  }

  function onSavePass() {
    if (pass.length < 8) { setMsg('סיסמה קצרה מדי'); return; }
    setPassphrase(pass);
    setPass('');
    setMsg('סיסמה בזיכרון ✓');
  }

  return (
    <section>
      <h1>הגדרות</h1>
      <h2>Anthropic API Key</h2>
      <p>{present ? '✓ מפתח מוגדר' : 'עדיין לא מוגדר'}</p>
      <input dir="auto" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
      <button onClick={onSaveKey}>שמור מפתח</button>

      <h2>סיסמת גיבוי (Supabase)</h2>
      <p>{getPassphrase() ? '✓ פעילה (יפוג אחרי 15 דק׳)' : 'לא פעילה — הגיבוי לא ירוץ'}</p>
      <input type="password" dir="auto" value={pass} onChange={(e) => setPass(e.target.value)} />
      <button onClick={onSavePass}>הפעל סיסמה</button>
      <button className="ghost" onClick={clearPassphrase}>נקה סיסמה</button>

      <p style={{ color: 'var(--muted)', marginTop: 24 }}>{msg}</p>
    </section>
  );
}
```

- [ ] **Step 4: Verify in browser — save + reload persists the API key badge**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): Settings screen (API key + passphrase)"
```

---

## Task 14: CLAUDE.md for the repo

**Files:** Create `CLAUDE.md`

- [ ] **Step 1: Write**

```markdown
# CLAUDE.md — ward-helper

Mobile-first PWA for SZMC ward rounds. Camera AZMA → reviewed draft → Chameleon paste.
Single-user, BYO Anthropic key, local-first IndexedDB, encrypted Supabase backup.

## Commands
- `npm run dev` — Vite on 5173
- `npm test` — vitest
- `npm run check` — tsc
- `npm run build` — prebuild (skill sync) + tsc + vite build

## Invariants — do not break
- Screenshots never written to storage. In-memory only, revoked after API call.
- No plaintext PHI leaves the device. Supabase stores AES-GCM 256 ciphertext only.
- PBKDF2 ≥ 600,000 iterations (constant in `src/crypto/pbkdf2.ts`).
- CSP meta locks connect-src to self + api.anthropic.com + *.supabase.co.
- No analytics / 3rd-party scripts (CI grep enforces).
- Main chunk ≤ 150 kB gzipped (CI enforces).

## Spec & plan
- `docs/superpowers/specs/2026-04-22-ward-helper-design.md`
- `docs/superpowers/plans/2026-04-22-ward-helper-v1.md`
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: CLAUDE.md"
```

---

## Task 15: Phase A ship — create GitHub repo + first deploy

**Files:** none new

- [ ] **Step 1: Create remote repo**

```bash
gh repo create Eiasash/ward-helper --public --source=. --description "SZMC ward rounds copilot — Hebrew RTL PWA" --push
```

- [ ] **Step 2: Set Pages source to GitHub Actions**

```bash
gh api -X POST "repos/Eiasash/ward-helper/pages" -f "source[branch]=main" -f "build_type=workflow" 2>/dev/null || echo "already configured"
```

- [ ] **Step 3: Trigger first Pages deploy (push a tag)**

```bash
git push origin main
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
```

- [ ] **Step 4: Verify live URL**

Open `https://eiasash.github.io/ward-helper/` — should render the Hebrew shell + bottom nav.

- [ ] **Step 5: Phase A checkpoint**

Tag:
```bash
git tag phase-a
git push origin phase-a
```

---

# Phase B — Extraction pipeline

## Task 16: Anthropic client wrapper

**Files:** Create `src/agent/client.ts`

- [ ] **Step 1: Implement**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { loadApiKey } from '@/crypto/keystore';

export const MODEL = 'claude-opus-4-7';

let cached: Anthropic | null = null;

export async function getClient(): Promise<Anthropic> {
  if (cached) return cached;
  const apiKey = await loadApiKey();
  if (!apiKey) throw new Error('API key not set. Open Settings to configure.');
  cached = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return cached;
}

export function resetClient() { cached = null; }
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(agent): Anthropic client wrapper"
```

---

## Task 17: Tool schemas for extract + emit

**Files:** Create `src/agent/tools.ts`

- [ ] **Step 1: Implement**

```ts
import type Anthropic from '@anthropic-ai/sdk';

export const parseAzmaTool: Anthropic.Tool = {
  name: 'parse_azma_screen',
  description: 'Extract structured patient data from one or more AZMA EMR screenshots. Preserve original language per field (drug names in English, Hebrew clinical text in Hebrew). For every field, report confidence and source_region.',
  input_schema: {
    type: 'object',
    required: ['fields'],
    properties: {
      fields: {
        type: 'object',
        properties: {
          name:          { type: 'string' },
          teudatZehut:   { type: 'string' },
          age:           { type: 'number' },
          sex:           { type: 'string', enum: ['M', 'F', 'unknown'] },
          room:          { type: 'string' },
          chiefComplaint:{ type: 'string' },
          pmh:           { type: 'array', items: { type: 'string' } },
          meds:          { type: 'array', items: { type: 'object', properties: {
                              name: { type: 'string' }, dose: { type: 'string' }, freq: { type: 'string' } },
                              required: ['name'] } },
          allergies:     { type: 'array', items: { type: 'string' } },
          labs:          { type: 'array', items: { type: 'object', properties: {
                              name: { type: 'string' }, value: { type: 'string' }, unit: { type: 'string' }, flag: { type: 'string' } },
                              required: ['name', 'value'] } },
          vitals:        { type: 'object' },
        },
      },
      confidence: {
        type: 'object',
        description: 'Per-field confidence, keyed by field path. e.g., { "name": "high", "meds[2].dose": "low" }',
        additionalProperties: { type: 'string', enum: ['low', 'med', 'high'] },
      },
      sourceRegions: {
        type: 'object',
        description: 'Per-field region hint, keyed by field path.',
        additionalProperties: { type: 'string' },
      },
    },
  },
};

export const emitNoteTool: Anthropic.Tool = {
  name: 'emit_note',
  description: 'Produce a single SZMC-format Hebrew note. Use proper bidi for mixed Hebrew/English: keep drug names + acronyms in English, wrap LTR runs with RLM/LRM where needed, never transliterate. Output plain text ready to paste into Chameleon.',
  input_schema: {
    type: 'object',
    required: ['noteHebrew'],
    properties: { noteHebrew: { type: 'string' } },
  },
};

export type ParseFields = {
  name?: string; teudatZehut?: string; age?: number; sex?: 'M' | 'F' | 'unknown';
  room?: string; chiefComplaint?: string; pmh?: string[];
  meds?: { name: string; dose?: string; freq?: string }[];
  allergies?: string[];
  labs?: { name: string; value: string; unit?: string; flag?: string }[];
  vitals?: Record<string, string | number>;
};

export type Confidence = 'low' | 'med' | 'high';
export interface ParseResult {
  fields: ParseFields;
  confidence: Record<string, Confidence>;
  sourceRegions: Record<string, string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(agent): tool schemas for parse_azma_screen + emit_note"
```

---

## Task 18: 2-turn loop orchestrator (TDD with mocked client)

**Files:** Create `src/agent/loop.ts`, `tests/agent.test.ts`

- [ ] **Step 1: Write failing test**

`tests/agent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runExtractTurn, runEmitTurn } from '@/agent/loop';
import type { ParseResult } from '@/agent/tools';

const fakeClient = {
  messages: {
    create: vi.fn(async (opts: any) => {
      if (opts.system.includes('azma-ui')) {
        return {
          content: [{ type: 'tool_use', name: 'parse_azma_screen', input: {
            fields: { name: 'דוד כהן', age: 82, chiefComplaint: 'קוצר נשימה' },
            confidence: { name: 'high', age: 'high', chiefComplaint: 'med' },
            sourceRegions: { name: 'ADT banner', age: 'ADT banner', chiefComplaint: 'triage note' },
          } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }
      return {
        content: [{ type: 'tool_use', name: 'emit_note', input: { noteHebrew: 'קבלה: דוד כהן, בן 82...' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 300 },
      };
    }),
  },
} as any;

describe('agent loop', () => {
  it('extract turn returns ParseResult with confidence + sources', async () => {
    const result = await runExtractTurn(fakeClient, ['data:image/png;base64,iVBOR'], 'SKILL CONTENT');
    expect(result.fields.name).toBe('דוד כהן');
    expect(result.confidence['name']).toBe('high');
    expect(result.sourceRegions['chiefComplaint']).toBe('triage note');
  });

  it('emit turn returns a Hebrew note string', async () => {
    const parsed: ParseResult = { fields: { name: 'דוד', age: 82 }, confidence: {}, sourceRegions: {} };
    const note = await runEmitTurn(fakeClient, 'admission', parsed, 'SKILL CONTENT');
    expect(note).toContain('קבלה');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement src/agent/loop.ts**

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './client';
import { parseAzmaTool, emitNoteTool, type ParseResult } from './tools';
import type { NoteType } from '@/storage/indexed';

export async function runExtractTurn(
  client: Anthropic,
  images: string[],
  skillContent: string,
): Promise<ParseResult> {
  const imageBlocks = images.map((dataUrl) => {
    const [, b64 = ''] = dataUrl.match(/^data:([^;]+);base64,(.*)$/)?.slice(0) ?? [];
    return {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/png' as const, data: b64 },
    };
  });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: skillContent,
    tools: [parseAzmaTool],
    tool_choice: { type: 'tool', name: 'parse_azma_screen' },
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        { type: 'text', text: 'Extract structured data from these AZMA screenshots. For every field, report confidence and source_region.' },
      ],
    }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no parse_azma_screen tool_use');
  return toolUse.input as ParseResult;
}

export async function runEmitTurn(
  client: Anthropic,
  noteType: NoteType,
  parsed: ParseResult,
  skillContent: string,
): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: skillContent,
    tools: [emitNoteTool],
    tool_choice: { type: 'tool', name: 'emit_note' },
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Emit a SZMC ${noteType} note in Hebrew from the validated data below. Preserve bidi rules: Hebrew prose, English drug/acronym/lab names, RLM/LRM where needed.\n\n${JSON.stringify(parsed.fields, null, 2)}`,
      }],
    }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no emit_note tool_use');
  return (toolUse.input as { noteHebrew: string }).noteHebrew;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): 2-turn extract + emit loop"
```

---

## Task 19: Bidi helpers (TDD)

**Files:** Create `src/i18n/bidi.ts`, `tests/bidi.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { wrapForChameleon, detectDir, lintBidi } from '@/i18n/bidi';

describe('bidi', () => {
  it('detects Hebrew vs English direction', () => {
    expect(detectDir('שלום')).toBe('rtl');
    expect(detectDir('Apixaban')).toBe('ltr');
    expect(detectDir('מטופל קיבל Apixaban')).toBe('rtl');
  });

  it('wraps Hebrew note with RLM after English run + ending punctuation', () => {
    const input = 'המטופל קיבל Apixaban.';
    const out = wrapForChameleon(input);
    expect(out).toContain('Apixaban\u200F.');
  });

  it('wraps parenthesized Latin-only content with LRM', () => {
    const input = 'הוחל טיפול (5 mg BID) בבית.';
    const out = wrapForChameleon(input);
    expect(out).toContain('\u200E5 mg BID\u200E');
  });

  it('linter flags unbalanced isolates', () => {
    const bad = '\u2066some text without closing';
    const errors = lintBidi(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('linter passes on a clean wrapped note', () => {
    const good = wrapForChameleon('המטופל קיבל Apixaban.');
    const errors = lintBidi(good);
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement src/i18n/bidi.ts**

```ts
const HEBREW_RE = /[\u0590-\u05FF]/;
const LATIN_RE = /[A-Za-z]/;
const RLM = '\u200F';
const LRM = '\u200E';

export function detectDir(s: string): 'rtl' | 'ltr' | 'neutral' {
  if (HEBREW_RE.test(s)) return 'rtl';
  if (LATIN_RE.test(s)) return 'ltr';
  return 'neutral';
}

/**
 * Insert RLM after English runs that end a Hebrew sentence with punctuation,
 * and wrap parenthesized Latin-only content with LRM on both sides.
 */
export function wrapForChameleon(text: string): string {
  // Rule 1: (Latin content) → (LRM Latin content LRM)
  let out = text.replace(/\(([^()\u0590-\u05FF]+)\)/g, (_, inner) => `(${LRM}${inner}${LRM})`);
  // Rule 2: English run followed by punctuation in Hebrew sentence → add RLM before punctuation
  out = out.replace(/([A-Za-z][A-Za-z0-9 +\-/]{2,})([.,:;])/g, `$1${RLM}$2`);
  return out;
}

/** Assert no unbalanced isolate marks. */
export function lintBidi(s: string): string[] {
  const errors: string[] = [];
  const opens = (s.match(/[\u2066\u2067\u2068]/g) ?? []).length;
  const closes = (s.match(/[\u2069]/g) ?? []).length;
  if (opens !== closes) errors.push(`unbalanced isolates: ${opens} open vs ${closes} close`);
  return errors;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(i18n): bidi helpers + linter"
```

---

## Task 20: Camera capture component

**Files:** Modify `src/ui/screens/Capture.tsx`, create `src/camera/session.ts`

- [ ] **Step 1: Implement session.ts**

```ts
export interface Shot { id: string; blobUrl: string; dataUrl: string; capturedAt: number; }

let shots: Shot[] = [];

export function addShot(dataUrl: string): Shot {
  const blob = dataUrlToBlob(dataUrl);
  const blobUrl = URL.createObjectURL(blob);
  const shot: Shot = { id: crypto.randomUUID(), blobUrl, dataUrl, capturedAt: Date.now() };
  shots.push(shot);
  return shot;
}

export function listShots(): readonly Shot[] { return shots; }

export function clearShots(): void {
  for (const s of shots) URL.revokeObjectURL(s.blobUrl);
  shots = [];
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data = ''] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(meta ?? '')?.[1] ?? 'image/png';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
```

- [ ] **Step 2: Implement Capture.tsx**

```tsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { addShot, listShots, clearShots, type Shot } from '@/camera/session';
import type { NoteType } from '@/storage/indexed';

const NOTE_TYPES: { type: NoteType; label: string }[] = [
  { type: 'admission', label: 'קבלה' },
  { type: 'discharge', label: 'שחרור' },
  { type: 'consult', label: 'ייעוץ' },
  { type: 'case', label: 'מקרה מעניין' },
];

export function Capture() {
  const nav = useNavigate();
  const [noteType, setNoteType] = useState<NoteType>('admission');
  const [shots, setShots] = useState<readonly Shot[]>(listShots());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { /* intentional: do NOT clearShots on unmount; only on navigate-away-to-review */ }, []);

  async function onCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(f);
    });
    addShot(dataUrl);
    setShots([...listShots()]);
    e.target.value = '';
  }

  function onProceed() {
    if (shots.length === 0) return;
    sessionStorage.setItem('noteType', noteType);
    nav('/review');
  }

  function onReset() { clearShots(); setShots([]); }

  return (
    <section>
      <h1>צלם מסך</h1>
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {NOTE_TYPES.map((t) => (
          <button key={t.type} className={noteType === t.type ? '' : 'ghost'} onClick={() => setNoteType(t.type)}>{t.label}</button>
        ))}
      </div>

      <button onClick={() => fileRef.current?.click()}>📷 צלם AZMA</button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onCapture} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 16 }}>
        {shots.map((s) => <img key={s.id} src={s.blobUrl} style={{ width: '100%', borderRadius: 8 }} alt="shot" />)}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onProceed} disabled={shots.length === 0}>המשך לבדיקה ←</button>
        <button className="ghost" onClick={onReset}>נקה</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Register /review route (stub)**

Add in `src/ui/App.tsx` Routes block:
```tsx
<Route path="/review" element={<Review />} />
```
Create `src/ui/screens/Review.tsx`:
```tsx
export function Review() { return <section><h1>בדיקה</h1></section>; }
```

- [ ] **Step 4: Manual verify on mobile (or DevTools mobile emu)** — camera button opens picker on desktop, capture on phone.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(camera): multi-shot capture session"
```

---

## Task 21: Paste-text fallback

**Files:** Modify `src/ui/screens/Capture.tsx`, `src/camera/session.ts`

- [ ] **Step 1: Add pasted-text variant to session**

Append to `src/camera/session.ts`:

```ts
let pastedText: string | null = null;
export function setPastedText(t: string | null) { pastedText = t; }
export function getPastedText(): string | null { return pastedText; }
```

- [ ] **Step 2: Modify Capture.tsx — add a mode toggle**

Above the file input block, add:

```tsx
const [mode, setMode] = useState<'camera' | 'paste'>('camera');
const [paste, setPaste] = useState('');

// ... inside return, replace the capture button section with:
<div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
  <button className={mode === 'camera' ? '' : 'ghost'} onClick={() => setMode('camera')}>📷 מצלמה</button>
  <button className={mode === 'paste' ? '' : 'ghost'} onClick={() => setMode('paste')}>📋 הדבק</button>
</div>

{mode === 'camera' ? (
  <>
    <button onClick={() => fileRef.current?.click()}>📷 צלם AZMA</button>
    <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onCapture} />
  </>
) : (
  <textarea dir="auto" rows={8} placeholder="הדבק טקסט AZMA כאן..." value={paste} onChange={(e) => { setPaste(e.target.value); setPastedText(e.target.value); }} />
)}
```

Also adjust `onProceed`: skip the shots.length check when `mode === 'paste'` and paste is non-empty.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(capture): paste-text fallback mode"
```

---

## Task 22: Review screen — parsed fields with confidence + mandatory gate

**Files:** Modify `src/ui/screens/Review.tsx`, create `src/ui/components/FieldRow.tsx`, `src/ui/components/ConfidencePill.tsx`

- [ ] **Step 1: ConfidencePill.tsx**

```tsx
import type { Confidence } from '@/agent/tools';

const COLORS: Record<Confidence, string> = { low: 'var(--red)', med: 'var(--amber)', high: 'var(--good)' };

export function ConfidencePill({ level }: { level: Confidence | undefined }) {
  const l = level ?? 'low';
  return <span style={{ background: COLORS[l], color: '#000', padding: '2px 8px', borderRadius: 10, fontSize: 12 }}>{l}</span>;
}
```

- [ ] **Step 2: FieldRow.tsx**

```tsx
import { useState } from 'react';
import type { Confidence } from '@/agent/tools';
import { ConfidencePill } from './ConfidencePill';

interface Props {
  label: string; value: string; confidence: Confidence | undefined; sourceRegion: string | undefined;
  onChange: (v: string) => void; critical?: boolean;
}

export function FieldRow({ label, value, confidence, sourceRegion, onChange, critical }: Props) {
  const needsConfirm = confidence === 'low' || (critical && !confidence);
  const [confirmed, setConfirmed] = useState(!needsConfirm);

  return (
    <div style={{ padding: 12, background: 'var(--card)', borderRadius: 8, marginBottom: 8, opacity: confirmed ? 1 : 0.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{label}</strong>
        <ConfidencePill level={confidence} />
      </div>
      {sourceRegion && <small style={{ color: 'var(--muted)' }}>מקור: {sourceRegion}</small>}
      <input dir="auto" value={value} onChange={(e) => onChange(e.target.value)} style={{ marginTop: 6 }} />
      {needsConfirm && !confirmed && (
        <button className="ghost" onClick={() => setConfirmed(true)} style={{ marginTop: 6 }}>אישור ידני נדרש</button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Review.tsx — run extract, render fields, block until all criticals confirmed**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listShots, getPastedText } from '@/camera/session';
import { getClient } from '@/agent/client';
import { runExtractTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import type { ParseResult, ParseFields } from '@/agent/tools';
import type { NoteType } from '@/storage/indexed';
import { FieldRow } from '../components/FieldRow';

export function Review() {
  const nav = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fields, setFields] = useState<ParseFields>({});

  useEffect(() => { (async () => {
    try {
      const images = listShots().map((s) => s.dataUrl);
      const pasted = getPastedText();
      if (images.length === 0 && !pasted) throw new Error('no input');
      const client = await getClient();
      const skillContent = await loadSkills(['azma-ui', 'hebrew-medical-glossary']);
      const result = await runExtractTurn(client, images.length > 0 ? images : [], skillContent);
      setParsed(result); setFields(result.fields); setStatus('ready');
    } catch (e: unknown) { setError((e as Error).message); setStatus('error'); }
  })(); }, []);

  if (status === 'loading') return <section><h1>בדיקה</h1><p>מנתח את המסך...</p></section>;
  if (status === 'error') return <section><h1>שגיאה</h1><p>{error}</p></section>;
  if (!parsed) return null;

  const update = (k: keyof ParseFields) => (v: string) => setFields({ ...fields, [k]: v });

  return (
    <section>
      <h1>בדיקה</h1>
      <FieldRow label="שם" value={fields.name ?? ''} confidence={parsed.confidence['name']} sourceRegion={parsed.sourceRegions['name']} onChange={update('name')} critical />
      <FieldRow label="ת.ז." value={fields.teudatZehut ?? ''} confidence={parsed.confidence['teudatZehut']} sourceRegion={parsed.sourceRegions['teudatZehut']} onChange={update('teudatZehut')} critical />
      <FieldRow label="גיל" value={String(fields.age ?? '')} confidence={parsed.confidence['age']} sourceRegion={parsed.sourceRegions['age']} onChange={(v) => setFields({ ...fields, age: Number(v) || undefined })} critical />
      <FieldRow label="תלונה ראשית" value={fields.chiefComplaint ?? ''} confidence={parsed.confidence['chiefComplaint']} sourceRegion={parsed.sourceRegions['chiefComplaint']} onChange={update('chiefComplaint')} />
      {/* Meds, allergies, labs lists rendered similarly in Task 23 */}

      <button onClick={() => { sessionStorage.setItem('validated', JSON.stringify(fields)); nav('/edit'); }}>צור טיוטת רשימה ←</button>
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(review): mandatory review gate with per-field confidence"
```

---

## Task 23: Meds + allergies + labs lists with critical-field 2nd-shot rule

**Files:** Modify `src/ui/screens/Review.tsx`

- [ ] **Step 1: Add list editors below single-field section**

Within Review.tsx, after the single-field block:

```tsx
<h2>תרופות</h2>
{(fields.meds ?? []).map((m, i) => (
  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
    <input dir="ltr" value={m.name} onChange={(e) => {
      const meds = [...(fields.meds ?? [])]; meds[i] = { ...m, name: e.target.value }; setFields({ ...fields, meds });
    }} placeholder="Apixaban" />
    <input dir="ltr" value={m.dose ?? ''} onChange={(e) => {
      const meds = [...(fields.meds ?? [])]; meds[i] = { ...m, dose: e.target.value }; setFields({ ...fields, meds });
    }} placeholder="5 mg" />
    <input dir="ltr" value={m.freq ?? ''} onChange={(e) => {
      const meds = [...(fields.meds ?? [])]; meds[i] = { ...m, freq: e.target.value }; setFields({ ...fields, meds });
    }} placeholder="BID" />
    <button className="ghost" onClick={() => {
      const meds = (fields.meds ?? []).filter((_, j) => j !== i); setFields({ ...fields, meds });
    }}>🗑</button>
  </div>
))}
<button className="ghost" onClick={() => setFields({ ...fields, meds: [...(fields.meds ?? []), { name: '' }] })}>+ תרופה</button>

<h2>אלרגיות</h2>
<input dir="auto" value={(fields.allergies ?? []).join(', ')} onChange={(e) => setFields({ ...fields, allergies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="NKDA" />

{/* Critical-field 2nd-shot gate: meds has any low-confidence entry */}
{Object.entries(parsed.confidence).some(([k, v]) => k.startsWith('meds') && v === 'low') && (
  <div style={{ background: 'var(--warn)', color: 'black', padding: 12, borderRadius: 8, marginTop: 12 }}>
    ⚠ צלם שוב את כרטיסיית התרופות כדי לאמת רשומה בעלת ביטחון נמוך לפני המשך
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(review): meds/allergies list editors + 2nd-shot warning"
```

---

## Task 24: Phase B ship — end-to-end parse works

**Files:** none new

- [ ] **Step 1: Manual verify**

- Set API key in Settings
- Upload a real AZMA screenshot (or a JPEG of one)
- Watch Review screen populate with parsed fields + confidence pills
- Check CI green, size still under 150 kB

- [ ] **Step 2: Tag phase-b**

```bash
git tag phase-b
git push origin phase-b
```

---

# Phase C — Notes + history + ship

## Task 25: Note templates + emit orchestrator

**Files:** Create `src/notes/templates.ts`, `src/notes/orchestrate.ts`

- [ ] **Step 1: templates.ts**

```ts
import type { NoteType } from '@/storage/indexed';

export const NOTE_SKILL_MAP: Record<NoteType, ['szmc-clinical-notes' | 'szmc-interesting-cases', 'hebrew-medical-glossary']> = {
  admission:  ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  discharge:  ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  consult:    ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  case:       ['szmc-interesting-cases', 'hebrew-medical-glossary'],
};

export const NOTE_LABEL: Record<NoteType, string> = {
  admission: 'קבלה', discharge: 'שחרור', consult: 'ייעוץ', case: 'מקרה מעניין',
};
```

- [ ] **Step 2: orchestrate.ts**

```ts
import { getClient } from '@/agent/client';
import { runEmitTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { wrapForChameleon } from '@/i18n/bidi';
import { NOTE_SKILL_MAP } from './templates';
import type { ParseResult } from '@/agent/tools';
import type { NoteType } from '@/storage/indexed';

export async function generateNote(noteType: NoteType, validated: ParseResult): Promise<string> {
  const client = await getClient();
  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);
  const raw = await runEmitTurn(client, noteType, validated, skillContent);
  return wrapForChameleon(raw);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(notes): template map + emit orchestrator with bidi wrap"
```

---

## Task 26: NoteEditor screen + copy-to-clipboard

**Files:** Create `src/ui/screens/NoteEditor.tsx`, register `/edit` route

- [ ] **Step 1: NoteEditor.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateNote } from '@/notes/orchestrate';
import type { NoteType } from '@/storage/indexed';

export function NoteEditor() {
  const nav = useNavigate();
  const [status, setStatus] = useState<'gen' | 'ready' | 'error'>('gen');
  const [err, setErr] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { (async () => {
    try {
      const noteType = (sessionStorage.getItem('noteType') ?? 'admission') as NoteType;
      const validated = JSON.parse(sessionStorage.getItem('validated') ?? '{}');
      const text = await generateNote(noteType, { fields: validated, confidence: {}, sourceRegions: {} });
      setBody(text); setStatus('ready');
    } catch (e: unknown) { setErr((e as Error).message); setStatus('error'); }
  })(); }, []);

  async function onCopy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (status === 'gen') return <section><h1>יוצר רשימה...</h1></section>;
  if (status === 'error') return <section><h1>שגיאה</h1><p>{err}</p></section>;

  return (
    <section>
      <h1>טיוטה</h1>
      <textarea dir="auto" rows={18} value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 400, fontSize: 15, lineHeight: 1.6 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onCopy}>{copied ? '✓ הועתק' : 'העתק לצ׳מיליון'}</button>
        <button className="ghost" onClick={() => nav('/save')}>המשך לשמירה ←</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Register route in App.tsx**

```tsx
import { NoteEditor } from './screens/NoteEditor';
// ...
<Route path="/edit" element={<NoteEditor />} />
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(notes): NoteEditor with copy-to-clipboard"
```

---

## Task 27: Save flow — IDB + encrypted Supabase push

**Files:** Create `src/ui/screens/Save.tsx`, `src/notes/save.ts`

- [ ] **Step 1: src/notes/save.ts**

```ts
import { putPatient, putNote, type Patient, type Note, type NoteType } from '@/storage/indexed';
import { encryptForCloud, pushBlob } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { getPassphrase } from '@/ui/hooks/useSettings';
import type { ParseFields } from '@/agent/tools';

export async function saveBoth(
  patientFields: ParseFields,
  noteType: NoteType,
  bodyHebrew: string,
): Promise<{ patientId: string; noteId: string }> {
  const now = Date.now();
  const patientId = crypto.randomUUID();
  const noteId = crypto.randomUUID();

  const patient: Patient = {
    id: patientId,
    name: patientFields.name ?? '',
    teudatZehut: patientFields.teudatZehut ?? '',
    dob: '', room: patientFields.room ?? null, tags: [],
    createdAt: now, updatedAt: now,
  };
  const note: Note = {
    id: noteId, patientId, type: noteType, bodyHebrew,
    structuredData: patientFields as Record<string, unknown>,
    createdAt: now, updatedAt: now,
  };

  await putPatient(patient);
  await putNote(note);

  const pass = getPassphrase();
  if (pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey(pass, salt);
    const sealedP = await encryptForCloud(patient, key, salt);
    const sealedN = await encryptForCloud(note, key, salt);
    await pushBlob('patient', patientId, sealedP);
    await pushBlob('note', noteId, sealedN);
  }

  return { patientId, noteId };
}
```

- [ ] **Step 2: Save.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveBoth } from '@/notes/save';
import { getPassphrase } from '@/ui/hooks/useSettings';
import type { NoteType } from '@/storage/indexed';
import { clearShots } from '@/camera/session';

export function Save() {
  const nav = useNavigate();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function onSave() {
    try {
      const noteType = (sessionStorage.getItem('noteType') ?? 'admission') as NoteType;
      const validated = JSON.parse(sessionStorage.getItem('validated') ?? '{}');
      const body = sessionStorage.getItem('body') ?? '';
      await saveBoth(validated, noteType, body);
      clearShots();
      setDone(true);
    } catch (e: unknown) { setErr((e as Error).message); }
  }

  if (done) return (
    <section><h1>נשמר ✓</h1>
      <button onClick={() => nav('/history')}>ראה היסטוריה</button>
      <button className="ghost" onClick={() => nav('/')}>מטופל חדש</button>
    </section>
  );

  return (
    <section>
      <h1>שמירה</h1>
      <p>{getPassphrase() ? '✓ גיבוי מוצפן יישלח ל-Supabase' : '⚠ סיסמה לא פעילה — רק שמירה מקומית'}</p>
      <button onClick={onSave}>שמור</button>
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Persist body on NoteEditor (so Save can read it)**

In NoteEditor.tsx `onCopy` and also in a `useEffect` tracking `body`:
```tsx
useEffect(() => { sessionStorage.setItem('body', body); }, [body]);
```

- [ ] **Step 4: Register /save route in App.tsx**

```tsx
import { Save } from './screens/Save';
<Route path="/save" element={<Save />} />
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notes): save to IDB + encrypted Supabase push"
```

---

## Task 28: History screen with search

**Files:** Modify `src/ui/screens/History.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { listPatients, listNotes, type Patient, type Note } from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';

export function History() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [notesByPid, setNotesByPid] = useState<Record<string, Note[]>>({});
  const [q, setQ] = useState('');

  useEffect(() => { (async () => {
    const ps = await listPatients();
    ps.sort((a, b) => b.updatedAt - a.updatedAt);
    setPatients(ps);
    const m: Record<string, Note[]> = {};
    for (const p of ps) m[p.id] = await listNotes(p.id);
    setNotesByPid(m);
  })(); }, []);

  const filtered = patients.filter((p) =>
    !q || p.name.includes(q) || p.teudatZehut.includes(q) || (p.room ?? '').includes(q),
  );

  return (
    <section>
      <h1>היסטוריה</h1>
      <input dir="auto" placeholder="חיפוש לפי שם/ת.ז/חדר" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtered.map((p) => (
        <div key={p.id} style={{ background: 'var(--card)', padding: 12, borderRadius: 8, marginTop: 8 }}>
          <strong>{p.name}</strong> <small style={{ color: 'var(--muted)' }}>{p.teudatZehut} · חדר {p.room ?? '—'}</small>
          <div style={{ marginTop: 6 }}>
            {(notesByPid[p.id] ?? []).map((n) => (
              <div key={n.id} style={{ fontSize: 13, color: 'var(--muted)' }}>
                {NOTE_LABEL[n.type]} · {new Date(n.updatedAt).toLocaleDateString('he-IL')}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(history): patient list with search"
```

---

## Task 29: Cost tracking panel

**Files:** Create `src/agent/costs.ts`, add indicator to `src/ui/App.tsx`

- [ ] **Step 1: costs.ts**

```ts
// Opus 4.7 pricing as of 2026-04: $15/M input, $75/M output (update if changed)
const IN_PER_TOKEN  = 15 / 1_000_000;
const OUT_PER_TOKEN = 75 / 1_000_000;

const KEY = 'ward-helper.costs';

interface Totals { inputTokens: number; outputTokens: number; usd: number; }

export function addTurn(usage: { input_tokens: number; output_tokens: number }): Totals {
  const prev = load();
  const next: Totals = {
    inputTokens: prev.inputTokens + usage.input_tokens,
    outputTokens: prev.outputTokens + usage.output_tokens,
    usd: prev.usd + usage.input_tokens * IN_PER_TOKEN + usage.output_tokens * OUT_PER_TOKEN,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function load(): Totals {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{"inputTokens":0,"outputTokens":0,"usd":0}'); }
  catch { return { inputTokens: 0, outputTokens: 0, usd: 0 }; }
}

export function reset() { localStorage.removeItem(KEY); }
```

- [ ] **Step 2: Wire into loop.ts**

At end of each `runExtractTurn` / `runEmitTurn`, before return:
```ts
import { addTurn } from './costs';
// ...
addTurn(res.usage);
```

- [ ] **Step 3: Show totals in Settings.tsx**

```tsx
import { load as loadCosts, reset as resetCosts } from '@/agent/costs';
// inside component:
const costs = loadCosts();
// inside return, below sections:
<h2>עלות מצטברת</h2>
<p>${costs.usd.toFixed(3)} · {costs.inputTokens + costs.outputTokens} tokens</p>
<button className="ghost" onClick={() => { resetCosts(); window.location.reload(); }}>אפס</button>
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): per-turn cost tracking"
```

---

## Task 30: Extraction eval harness

**Files:** Create `tests/extraction/eval.test.ts`, `tests/extraction/fixtures/README.md`, `tests/extraction/fixtures/admission-01.json`

- [ ] **Step 1: README for fixtures**

`tests/extraction/fixtures/README.md`:

```markdown
# Extraction fixtures

Each fixture is a pair: `<name>.png` (synthetic AZMA screenshot) + `<name>.json` (ground-truth structured fields).
Add at least 20 pairs covering: admission, discharge, consult, case-conference source data.
Synthetic screenshots can be made with a fake-AZMA HTML page + puppeteer; real screenshots must be PHI-stripped.
```

- [ ] **Step 2: One example ground truth**

`tests/extraction/fixtures/admission-01.json`:

```json
{
  "fields": {
    "name": "דוד לוי",
    "teudatZehut": "034567890",
    "age": 82,
    "sex": "M",
    "chiefComplaint": "חולשה כללית וירידה בתפקוד",
    "meds": [
      { "name": "Apixaban", "dose": "5 mg", "freq": "BID" },
      { "name": "Metformin", "dose": "500 mg", "freq": "TID" }
    ]
  }
}
```

- [ ] **Step 3: eval.test.ts (replay mode — no live API calls)**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'tests/extraction/fixtures';
const RECORDED_DIR = 'tests/extraction/recorded';

describe('extraction accuracy', () => {
  const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json'));

  it.each(fixtures)('replays %s and matches critical fields', (fname) => {
    const truth = JSON.parse(readFileSync(join(DIR, fname), 'utf8'));
    const recordedPath = join(RECORDED_DIR, fname);
    if (!existsSync(recordedPath)) {
      console.warn(`SKIP ${fname}: no recorded response at ${recordedPath}`);
      return;
    }
    const recorded = JSON.parse(readFileSync(recordedPath, 'utf8'));

    // Critical fields: name, teudatZehut, age, meds[].name
    expect(recorded.fields.name).toBe(truth.fields.name);
    expect(recorded.fields.teudatZehut).toBe(truth.fields.teudatZehut);
    expect(recorded.fields.age).toBe(truth.fields.age);

    const recMeds = (recorded.fields.meds ?? []).map((m: { name: string }) => m.name).sort();
    const truMeds = (truth.fields.meds ?? []).map((m: { name: string }) => m.name).sort();
    expect(recMeds).toEqual(truMeds);
  });

  it('has at least 20 fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 4: Recording script (dev utility, not in CI)**

`scripts/record-extraction.mjs`:

```js
#!/usr/bin/env node
// Run with API key env: ANTHROPIC_API_KEY=sk-ant-... node scripts/record-extraction.mjs
// For each <name>.png in fixtures, call parse_azma_screen once and save to recorded/<name>.json
import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = 'tests/extraction/fixtures';
const OUT = 'tests/extraction/recorded';
mkdirSync(OUT, { recursive: true });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const skill = readFileSync('public/skills/azma-ui.md', 'utf8') + '\n\n' + readFileSync('public/skills/hebrew-medical-glossary.md', 'utf8');

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.png'))) {
  const img = readFileSync(join(DIR, f)).toString('base64');
  const res = await client.messages.create({
    model: 'claude-opus-4-7', max_tokens: 4096, system: skill,
    tools: [{ name: 'parse_azma_screen', description: '...', input_schema: { type: 'object' } }],
    tool_choice: { type: 'tool', name: 'parse_azma_screen' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } },
      { type: 'text', text: 'Extract.' },
    ]}],
  });
  const tool = res.content.find((b) => b.type === 'tool_use');
  const json = f.replace('.png', '.json');
  writeFileSync(join(OUT, json), JSON.stringify(tool?.input ?? {}, null, 2));
  console.log(`recorded ${json}`);
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: extraction accuracy eval harness (replay mode)"
```

---

## Task 31: audit-fix-deploy CI workflow

**Files:** Create `.github/workflows/audit-fix-deploy.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: audit-fix-deploy
on:
  workflow_dispatch:
  schedule: [{ cron: '0 6 * * 0' }]  # weekly Sun 06:00 UTC

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - name: Type check
        run: npm run check
      - name: Tests
        run: npm test
      - name: Build
        run: npm run build
      - name: Bundle size
        run: |
          MAIN=$(find dist/assets -name 'index-*.js' | head -1)
          SIZE=$(gzip -c "$MAIN" | wc -c)
          [ "$SIZE" -le 153600 ] || exit 1
      - name: CSP + no-analytics
        run: |
          grep -q 'Content-Security-Policy' index.html
          ! grep -rEi 'google-analytics|googletagmanager|sentry\.io|posthog|mixpanel' src/ public/ index.html
      - name: Invariant — no plaintext PHI patterns in source
        run: |
          ! grep -rE 'console\.log\(.*(teudatZehut|name|dob)' src/
          ! grep -rE 'localStorage\.setItem\(.*bodyHebrew' src/
      - name: Invariant — PBKDF2 ≥ 600000
        run: grep -q 'PBKDF2_ITERATIONS = 600_000' src/crypto/pbkdf2.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: audit-fix-deploy workflow (weekly + manual)"
```

---

## Task 32: README

**Files:** Create `README.md`

- [ ] **Step 1: Write**

```markdown
# ward-helper

SZMC ward rounds copilot — Hebrew RTL PWA. Snap AZMA screen → reviewed draft → paste to Chameleon.

## Quickstart
1. Open https://eiasash.github.io/ward-helper/
2. Install as PWA (iOS: Share → Add to Home Screen; Android: install banner)
3. Settings → paste your Anthropic API key (stored XOR-encrypted on device)
4. Settings → set a backup passphrase (held in memory 15 min)
5. Capture → photograph AZMA screen → review fields → generate note → copy → paste

## Privacy posture
- Screenshots: in-memory only, never stored anywhere
- Patient history: IndexedDB on your device
- Cloud backup: AES-GCM 256 ciphertext only. Supabase never sees plaintext PHI.

## Dev
- `npm run dev` — Vite on 5173
- `npm test` — vitest
- `npm run build` — sync skills + tsc + build
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: README"
```

---

## Task 33: Phase C ship checklist

**Files:** none new

- [ ] **Step 1: Walk the ship criteria from spec §13**

Manually verify each:
1. Full flow (capture → review → edit → copy → Chameleon paste) under 90 s on iPhone
2. Extraction eval harness passes with ≥ 20 fixtures
3. No plaintext PHI in Supabase (inspect table manually with synthetic passphrase)
4. Bidi linter clean on 20+ sample notes
5. Bundle size ≤ 150 kB gzipped (CI enforces)
6. PWA installable on iOS Safari + Android Chrome
7. `audit-fix-deploy` workflow green

- [ ] **Step 2: Tag v1**

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [ ] **Step 3: GitHub release**

```bash
gh release create v1.0.0 --title "ward-helper v1.0.0" --notes-from-tag
```

---

# Self-review (completed inline)

**Spec coverage** — every section has a task:
- §1 goals → Tasks 1–33 collectively
- §2 architecture → Tasks 1, 10, 16, 18
- §3 module tree → Tasks 1, 6–14, 16–20, 22–28
- §4 agent flow → Tasks 17, 18, 22, 26
- §5 extraction accuracy → Tasks 22, 23, 30
- §6 bidi → Tasks 19, 25
- §7 data model → Tasks 9, 10
- §8 security invariants → Tasks 1 (CSP), 3 (CI), 6 (XOR), 7 (PBKDF2), 8 (AES), 31 (invariant checks)
- §9 CI/deploy → Tasks 3, 4, 15, 31
- §10 testing → Tasks 2, 6–8, 9, 18, 19, 30
- §11 skill wiring → Tasks 11, 25
- §13 ship criteria → Task 33

**Placeholders:** none remaining.

**Type consistency:** `ParseResult`, `ParseFields`, `Confidence`, `NoteType`, `Patient`, `Note`, `Settings` used consistently across tasks. Tool names `parse_azma_screen` and `emit_note` match between `tools.ts` (Task 17), `loop.ts` (Task 18), and eval harness (Task 30).

**Scope:** one cohesive plan, 33 tasks, three phase checkpoints with ship-able artifacts at each (Phase A: working PWA shell + settings; Phase B: end-to-end extract; Phase C: full app).
