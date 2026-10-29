import assert from 'node:assert/strict';
import console from 'node:console';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PORT_NAMES = ['API', 'DB', 'SHADOW', 'MAILPIT', 'SMTP', 'POP3'];

/** @param {Record<string, string | undefined>} environment */
export function validateIsolatedPorts(environment) {
  const ports = PORT_NAMES.map((name) => environment[`E2E_LOCAL_${name}_PORT`]);
  assert(ports.every((port) => typeof port === 'string' && /^[1-9][0-9]{3,4}$/.test(port)
    && Number(port) >= 1024 && Number(port) <= 65535 && Number(port) !== 3000), 'invalid isolated service port');
  assert(new Set(ports).size === PORT_NAMES.length, 'isolated service ports must be distinct');
  return ports;
}

/** @param {string} run @param {string} attempt @param {string} mode */
export function isolatedProjectId(run, attempt, mode) {
  assert(/^[0-9]{1,20}$/.test(run) && /^[0-9]{1,4}$/.test(attempt), 'invalid isolated run identity');
  assert(mode === 'absent' || mode === 'installed-locked', 'invalid isolated schema mode');
  return `rfz-pr82-${run}-${attempt}-${mode}`;
}

export async function allocateIsolatedPorts() {
  /** @type {net.Server[]} */
  const servers = [];
  try {
    const ports = [];
    for (const name of PORT_NAMES) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(undefined));
      });
      const address = server.address();
      assert(address && typeof address !== 'string', `missing allocated ${name} port`);
      ports.push(String(address.port));
    }
    // Hold every listener until the whole set has been selected, so the
    // allocator cannot accidentally reuse a port within its own plan.
    const environment = Object.fromEntries(PORT_NAMES.map((name, i) => [`E2E_LOCAL_${name}_PORT`, ports[i]]));
    validateIsolatedPorts(environment);
    return environment;
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

/** @param {string} config @param {string} project @param {Record<string, string>} ports */
export function configureIsolatedStack(config, project, ports) {
  validateIsolatedPorts(ports);
  assert(/^rfz-pr82-[0-9]+-[0-9]+-(absent|installed-locked)$/.test(project), 'invalid isolated project ID');
  const substitutions = [
    [/^project_id = "runfazone-pr82-isolated-auth"$/gm, `project_id = "${project}"`],
    [/^port = 54321$/gm, `port = ${ports.E2E_LOCAL_API_PORT}`],
    [/^port = 54322$/gm, `port = ${ports.E2E_LOCAL_DB_PORT}`],
    [/^shadow_port = 54320$/gm, `shadow_port = ${ports.E2E_LOCAL_SHADOW_PORT}`],
    [/^port = 54324$/gm, `port = ${ports.E2E_LOCAL_MAILPIT_PORT}`],
    [/^smtp_port = 54325$/gm, `smtp_port = ${ports.E2E_LOCAL_SMTP_PORT}`],
    [/^pop3_port = 54326$/gm, `pop3_port = ${ports.E2E_LOCAL_POP3_PORT}`],
  ];
  for (const [pattern, replacement] of substitutions) {
    assert([...config.matchAll(pattern)].length === 1, 'unexpected disposable configuration template');
    config = config.replace(pattern, replacement);
  }
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 4, 'expected disposable config and environment output paths');
    const project = isolatedProjectId(process.env.GITHUB_RUN_ID || '', process.env.GITHUB_RUN_ATTEMPT || '', process.env.MODE || '');
    const ports = await allocateIsolatedPorts();
    fs.writeFileSync(process.argv[2], configureIsolatedStack(fs.readFileSync(process.argv[2], 'utf8'), project, ports));
    fs.appendFileSync(process.argv[3], [`RFZ_STACK_PROJECT_ID=${project}`, ...Object.entries(ports).map(([key, value]) => `${key}=${value}`), ''].join('\n'));
    console.log(`ISOLATED_AUTH_PORT_PLAN_PASS project=${project} distinct_ports=${PORT_NAMES.length}`);
  } catch (error) {
    console.error(`Disposable Auth configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
