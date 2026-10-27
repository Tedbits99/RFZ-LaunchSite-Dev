import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stdout } from 'node:process';

// Prevent activating a metadata-only Worker version after deploying CSS/JS.
const yaml = readFileSync('.github/workflows/runfazone-preview.yml', 'utf8');
function location(stepName) {
  const found = yaml.indexOf('      - name: ' + stepName + '\n');
  assert.ok(found >= 0, 'Missing deployment step: ' + stepName);
  return found;
}
const bootstrap = location('Bootstrap Worker version for runtime secret provisioning');
const signer = location('Provision preview recovery proof signer before final assets deployment');
const assets = location('Assert immutable artifact contains website CSS and JavaScript');
const upload = location('Deploy only the named Worker on workers.dev as final asset-bearing version');
const verify = location('Resolve normal and immutable version URLs');
assert.ok(bootstrap < signer && signer < assets && assets < upload && upload < verify,
  'The bootstrap deploy must precede secret provisioning, and the final asset-bearing deploy must run after it.');
const afterDeploy = yaml.slice(upload).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
assert.ok(!/npx\s+--yes\s+wrangler[^\n]*secret\s+(put|delete)/.test(afterDeploy),
  'Secrets updated after full upload can create an asset-less Worker version.');
const bootstrapSection = yaml.slice(bootstrap, signer);
assert.ok(/npx\s+--yes\s+wrangler[^\n]*deploy/.test(bootstrapSection),
  'The bootstrap step must deploy a Worker version before secret provisioning.');
assert.ok(yaml.includes('include-hidden-files: true'));
assert.ok(yaml.includes('.open-next/**'));
assert.ok(yaml.slice(assets, upload).includes('css_count'));
assert.ok(yaml.slice(assets, upload).includes('js_count'));
stdout.write('PREVIEW_STATIC_ASSETS_ORDER_PASS signer -> CSS/JS verification -> Worker deploy -> version verification\n');
