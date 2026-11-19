// Copies non-TS runtime assets (disposable list) next to the compiled JS.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'src', 'verifier', 'data');
const dest = path.join(__dirname, '..', 'dist', 'verifier', 'data');
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
