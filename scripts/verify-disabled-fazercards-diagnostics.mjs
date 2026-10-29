import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import console from 'node:console';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'supabase/functions/fazercards-test');
const forbidden = /api\.fzr\.cards|SUPPLIER_FAZERCARDS_API_KEY|topups\/order|\bfetch\s*\(|Deno\.env|\bcreateClient\s*\(/i;

function verify(directory) {
  const index = fs.readFileSync(path.join(directory, 'index.ts'), 'utf8');
  const response = fs.readFileSync(path.join(directory, 'disabledResponse.ts'), 'utf8');
  assert(index.includes('return disabledFazerCardsDiagnosticResponse();'), 'disabled response must remain the handler result');
  assert(response.includes('status: 503'), 'diagnostic response must remain unavailable');
  function visit(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const filename = path.join(root, entry.name);
      assert(!entry.isSymbolicLink(), 'diagnostic source must not contain symbolic links');
      if (entry.isDirectory()) visit(filename);
      else assert(!forbidden.test(fs.readFileSync(filename, 'utf8')), `provider access forbidden in ${path.relative(directory, filename)}`);
    }
  }
  visit(directory);
}

function selfTest() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rfz-diagnostics-guard-'));
  try {
    const fixture = path.join(temporary, 'fixture with spaces');
    fs.cpSync(sourceRoot, fixture, { recursive: true });
    verify(fixture);
    for (const introduced of [
      'const endpoint = "https://api.fzr.cards/api/v2/topups/order";',
      'fetch("https://example.invalid");',
      'Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY");',
      'createClient("synthetic-only");',
    ]) {
      const injected = path.join(fixture, 'injected.ts');
      fs.writeFileSync(injected, introduced);
      assert.throws(() => verify(fixture), 'forbidden fixture must be rejected');
      fs.unlinkSync(injected);
    }
    fs.unlinkSync(path.join(fixture, 'disabledResponse.ts'));
    assert.throws(() => verify(fixture), 'missing required source must fail closed');
    assert.throws(() => verify(path.join(temporary, 'missing')), 'unreadable directory must fail closed');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('DISABLED_FAZERCARDS_DIAGNOSTICS_GUARD_SELF_TEST_PASS');
}

try {
  if (process.argv[2] === '--self-test') selfTest();
  else {
    assert(process.argv.length === 2, 'unsupported guard arguments');
    verify(sourceRoot);
    console.log('DISABLED_FAZERCARDS_DIAGNOSTICS_GUARD_PASS');
  }
} catch (error) {
  console.error(`Disabled FazerCards diagnostic guard failed: ${error.message}`);
  process.exitCode = 1;
}
