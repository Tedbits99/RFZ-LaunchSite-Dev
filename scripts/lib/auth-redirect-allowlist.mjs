import { readFileSync } from 'node:fs';
import process from 'node:process';

export function normalizeAuthRedirectAllowlist(value) {
  const source = Array.isArray(value) ? value : [value];
  const entries = source.flatMap((entry) =>
    typeof entry === 'string' ? entry.split(/[,\r\n]+/) : [],
  );
  return [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
}

function matchesGlob(value, pattern) {
  const expression = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${expression}$`).test(value);
}

export function inspectAuthRedirectAllowlist(value, callback, wildcard) {
  const rules = normalizeAuthRedirectAllowlist(value);
  return {
    format: Array.isArray(value) ? 'array' : typeof value,
    ruleCount: rules.length,
    exactCallback: rules.includes(callback),
    wildcardRule: rules.includes(wildcard),
    callbackAllowed: rules.some((rule) => matchesGlob(callback, rule)),
  };
}

export function mergeAuthRedirectAllowlist(value, callback, wildcard) {
  return [...normalizeAuthRedirectAllowlist(value), wildcard, callback]
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .join(',');
}

if (process.argv[1]?.endsWith('/auth-redirect-allowlist.mjs')) {
  const [operation, callback, wildcard] = process.argv.slice(2);
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('Invalid JSON input for Auth redirect allowlist helper.\n');
    process.exit(2);
  }

  if (operation === 'normalize') {
    process.stdout.write(`${JSON.stringify(normalizeAuthRedirectAllowlist(input))}\n`);
  } else if (operation === 'inspect' && callback && wildcard) {
    process.stdout.write(`${JSON.stringify(inspectAuthRedirectAllowlist(input, callback, wildcard))}\n`);
  } else if (operation === 'merge' && callback && wildcard) {
    process.stdout.write(`${mergeAuthRedirectAllowlist(input, callback, wildcard)}\n`);
  } else {
    process.stderr.write('Use normalize or inspect/merge with callback and wildcard arguments.\n');
    process.exit(2);
  }
}
