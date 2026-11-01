// Downloads the open-source NudeNet TFJS model (MIT, github.com/vladmandic/nudenet)
// into public/models/nudenet so the browser can run video moderation locally.
// Runs automatically after `npm install`. Skips files that already exist.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/vladmandic/nudenet/main/models/default-f16/';
const FILES = ['model.json', ...[1, 2, 3, 4, 5].map((i) => `group1-shard${i}of5.bin`)];
const OUT = path.join(process.cwd(), 'public', 'models', 'nudenet');

if (process.env.SKIP_MODEL_DOWNLOAD === '1') {
  console.log('[models] SKIP_MODEL_DOWNLOAD=1, skipping');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const dest = path.join(OUT, f);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
  process.stdout.write(`[models] downloading ${f} ... `);
  try {
    const res = await fetch(BASE + f);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  } catch (e) {
    console.log(`failed (${e.message}) — in-browser guard will be disabled; server AutoMod still works`);
    break;
  }
}
