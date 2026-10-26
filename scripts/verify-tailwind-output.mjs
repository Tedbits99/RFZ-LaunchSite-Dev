import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cwd, stdout } from 'node:process';

const cssRoot = join(cwd(), '.open-next', 'assets', '_next', 'static', 'css');
const cssFiles = (await readdir(cssRoot)).filter((file) => file.endsWith('.css'));

if (cssFiles.length === 0) {
  throw new Error('TAILWIND_OUTPUT_FAIL: OpenNext produced no CSS asset.');
}

const css = (await Promise.all(cssFiles.map((file) => readFile(join(cssRoot, file), 'utf8')))).join('\n');
const requiredMarkers = [
  ['Tailwind v4 marker', 'tailwindcss v4.'],
  ['header sizing utility', '.h-10{'],
  ['layout padding utility', '.px-5{'],
  ['card radius utility', '.rounded-2xl{'],
  ['heading typography utility', '.text-3xl{'],
  ['mobile grid utility', '.grid-cols-2{'],
  ['desktop responsive grid utility', '.lg\\:grid-cols-4{'],
];

for (const [label, marker] of requiredMarkers) {
  if (!css.includes(marker)) {
    throw new Error(`TAILWIND_OUTPUT_FAIL: missing ${label} (${marker}).`);
  }
}

if (css.includes('@tailwind')) {
  throw new Error('TAILWIND_OUTPUT_FAIL: legacy @tailwind directives remained in compiled CSS.');
}

stdout.write(`TAILWIND_OUTPUT_PASS css_files=${cssFiles.length} characters=${css.length}\n`);
