// BREACHLINE — entry program (Node 22, standard library only).
//
// The repository holds the game as plain static files under game/ and 3-4
// real screenshots under screenshots/. This program hands them in: it copies
// both trees to the output directory and writes dossier.json with the kit's
// own library, so the sealed scorer rebuilds the exact same bytes.
// In the grader the output directory is /output; anywhere else the
// MAKEFUN_OUTPUT_DIR environment variable stands in for it:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The gate's own caps, as the scorer applies them: only the text cap shapes
// the dossier bytes; the rest make this program fail exactly where the
// scorer would refuse the entry, instead of handing in something invalid.
const GATE_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function handIn(repoRoot, outputDir) {
  mkdirSync(outputDir, { recursive: true });

  // game/ is the whole playable game: index.html, ES modules, vendored three.js.
  cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

  // screenshots/ holds the maker's own renders of the game, first by name
  // being the cover. It must exist; an empty directory still copies cleanly
  // and buildDossier reports the missing images.
  const shotsOut = join(outputDir, 'screenshots');
  mkdirSync(shotsOut, { recursive: true });
  const shotsIn = join(repoRoot, 'screenshots');
  if (existsSync(shotsIn)) cpSync(shotsIn, shotsOut, { recursive: true });

  // The dossier is built from the copied trees, never from the repository,
  // so what the judge reads is exactly what was handed in.
  const dossier = buildDossier(outputDir, GATE_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  return dossier.length;
}

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const bytes = handIn(repoRoot, outputDir);
console.log(`handed in ${bytes} bytes of dossier to ${outputDir}`);
