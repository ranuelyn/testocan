#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Build Script (v2 — Full Feature Set)
 * ═══════════════════════════════════════════════════════════════
 *  Assembles the Chrome extension into the dist/ folder:
 *    1. Vite builds the popup (React → static JS/CSS)
 *    2. Copies manifest, background, content scripts, shared, icons
 */

import { execSync } from 'child_process';
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

console.log('🔨 Building Testocan…\n');

// Step 1: Vite build (popup)
console.log('  → Building popup with Vite…');
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

// Step 2: Copy manifest
console.log('  → Copying manifest.json…');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf-8'));

// Rewrite paths for the dist output
manifest.background.service_worker = 'background/index.js';
manifest.content_scripts[0].js = ['content/index.js'];
manifest.web_accessible_resources[0].resources = ['content/injected.js', 'content/replay.js'];
manifest.action.default_popup = 'popup.html';

writeFileSync(resolve(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Step 3: Copy background service worker + network monitor
console.log('  → Copying background scripts…');
mkdirSync(resolve(DIST, 'background'), { recursive: true });
cpSync(resolve(ROOT, 'src/background/index.js'), resolve(DIST, 'background/index.js'));
cpSync(resolve(ROOT, 'src/background/networkMonitor.js'), resolve(DIST, 'background/networkMonitor.js'));

// Step 4: Copy content scripts + replay engine
console.log('  → Copying content scripts…');
mkdirSync(resolve(DIST, 'content'), { recursive: true });
cpSync(resolve(ROOT, 'src/content/index.js'), resolve(DIST, 'content/index.js'));
cpSync(resolve(ROOT, 'src/content/injected.js'), resolve(DIST, 'content/injected.js'));
cpSync(resolve(ROOT, 'src/content/replay.js'), resolve(DIST, 'content/replay.js'));

// Step 5: Copy shared modules (used by background via importScripts)
console.log('  → Copying shared modules…');
mkdirSync(resolve(DIST, 'shared'), { recursive: true });
cpSync(resolve(ROOT, 'src/shared'), resolve(DIST, 'shared'), { recursive: true });

// Step 6: Copy icons
console.log('  → Copying icons…');
if (existsSync(resolve(ROOT, 'icons'))) {
  mkdirSync(resolve(DIST, 'icons'), { recursive: true });
  cpSync(resolve(ROOT, 'icons'), resolve(DIST, 'icons'), { recursive: true });
}

console.log('\n✅ Build complete → dist/');
console.log('   Load this folder as an unpacked extension in chrome://extensions\n');
