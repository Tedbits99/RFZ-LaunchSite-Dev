import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Prevent activating a metadata-only Worker version after deploying CSS/JS.
const yaml = readFileSync('.github/workflows/runfazone-preview.yml', 'utf8');
function location(stepName) {
  const found = yaml.indexOf('      - name: ' + stepName + '\n');
  assert.ok(found >= 0, 'Missing deployment step: ' + stepName);
  return found;
}
const signer = location('Provision preview recovery proof signer before assets deployment');
const assets = location('Assert immutable artifact contains website CSS and JavaScript');
const upload = location('Deploy only the named Worker on workers.dev');
const verify = location('Resolve normal and immutable version URLs');
assert.ok(signer < assets && assets < upload && upload < verify,
  'The full asset-bearing Wrangler deploy must run AFTER secret provisioning.');
const afterDeploy = yaml.slice(upload).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
assert.ok(!/npx\s+--yes\s+wrangler[^\n]*secret\s+(put|delete)/.test(afterDeploy),
  'Secrets updated after full upload can create an asset-less Worker version.');
assert.ok(yaml.includes('include-hidden-files: true'));
assert.ok(yaml.includes('.open-next/**'));
assert.ok(yaml.slice(assets, upload).includes('css_count'));
assert.ok(yaml.slice(assets, upload).includes('js_count'));
process.stdout.write('PREVIEW_STATIC_ASSETS_ORDER_PASS signer -> CSS/JS verification -> Worker deploy -> version verification\n');
