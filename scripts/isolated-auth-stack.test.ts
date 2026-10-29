import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { allocateIsolatedPorts, configureIsolatedStack, isolatedProjectId, PORT_NAMES, validateIsolatedPorts } from './isolated-auth-stack.mjs';

const template = readFileSync(new URL('../supabase/e2e/config.toml', import.meta.url), 'utf8');
const valid = Object.fromEntries(PORT_NAMES.map((name, i) => [`E2E_LOCAL_${name}_PORT`, String(41000 + i)]));

describe('disposable Auth port and project isolation', () => {
  it.each([undefined, '', '443', '3000', '65536', '041001', '127.0.0.1:41001', '41001\nX=bad'])('rejects invalid port %s', (port) => {
    expect(() => validateIsolatedPorts({ ...valid, E2E_LOCAL_API_PORT: port })).toThrow();
  });

  it('rejects reused ports rather than binding two services to one listener', () => {
    expect(() => validateIsolatedPorts({ ...valid, E2E_LOCAL_POP3_PORT: valid.E2E_LOCAL_API_PORT })).toThrow();
  });

  it('selects distinct free loopback ports while an unrelated listener remains open', async () => {
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const address = occupied.address();
      expect(address && typeof address !== 'string').toBeTruthy();
      const ports = await allocateIsolatedPorts();
      expect(new Set(validateIsolatedPorts(ports)).size).toBe(6);
      if (address && typeof address !== 'string') expect(Object.values(ports)).not.toContain(String(address.port));
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('changes only the disposable project and host ports, preserving internal SMTP and short-lived Auth policy', () => {
    const project = isolatedProjectId('1234', '2', 'installed-locked');
    const configured = configureIsolatedStack(template, project, valid);
    expect(configured).toContain(`project_id = "${project}"`);
    expect(configured).toContain('pop3_port = 41005');
    expect(configured).toContain('host = "inbucket"\nport = 1025');
    expect(configured).toContain('jwt_expiry = 60');
    expect(configured).toContain('refresh_token_reuse_interval = 10');
    expect(() => configureIsolatedStack(template.replace('pop3_port = 54326', ''), project, valid)).toThrow();
  });

  it('isolates runs and attempts and refuses injected project identities', () => {
    expect(isolatedProjectId('1234', '1', 'absent')).not.toBe(isolatedProjectId('1234', '2', 'absent'));
    expect(() => isolatedProjectId('1234\nBAD=x', '1', 'absent')).toThrow();
    expect(() => isolatedProjectId('1234', '1', 'hosted')).toThrow();
  });
});
