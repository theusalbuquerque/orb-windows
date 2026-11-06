// The web player remains one shared source of truth: this script makes a
// desktop-specific copy without modifying the marketing site or Orb Web.
const fs = require('node:fs');
const path = require('node:path');

const project = __dirname;
const source = path.join(project, '..', 'orb-web-extracted.html');
if (!fs.existsSync(source)) throw new Error('orb-web-extracted.html not found next to orb-windows/');
let html = fs.readFileSync(source, 'utf8');
const settingsButton = '<button id="open-settings" class="settings-button">Configurações</button>';
html = html.replace(settingsButton, '');
if (html.includes("$('open-settings')")) throw new Error('Stale sidebar settings handler');

const bootstrap = `<script>
try {
  const paired = localStorage.getItem('orb-windows-paired-session');
  if (paired && /^[a-f0-9]{64}$/.test(paired)) sessionStorage.setItem('orb-web-session', paired);
} catch { /* Login remains available via QR. */ }
</script>`;
const marker = "<script>'use strict';\nconst API";
if (!html.includes(marker)) throw new Error('Orb Web bootstrap marker changed');
html = html.replace(marker, bootstrap + marker);
if (!html.includes('</head>') || !html.includes('</body>')) throw new Error('HTML structure changed');
html = html.replace('</head>', '<link rel="stylesheet" href="desktop.css"></head>');
html = html.replace('</body>', '<script src="desktop-bridge.js"></script></body>');
fs.writeFileSync(path.join(project, 'Web', 'index.html'), html);
console.log('Orb desktop player updated:', html.length, 'characters');
