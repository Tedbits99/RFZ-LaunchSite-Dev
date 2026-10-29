import fs from 'node:fs';
import process from 'node:process';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) process.exit(0);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => /error|failed|refused|timeout|cannot|denied|unhealthy/i.test(line));
const safe = lines.map((line) => line
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_LOCAL_DATABASE_URL]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_LOCAL_JWT]')
  .replace(/((?:service_role|anon|api|db)[ _-]?(?:key|password|secret)\s*[:=]\s*)[^\s,]+/gi, '$1[REDACTED]')
  .replace(/(password\s*[=:]\s*)[^\s,]+/gi, '$1[REDACTED]'));
for (const line of safe.slice(-10)) process.stderr.write(`${line.slice(0, 500)}\n`);
