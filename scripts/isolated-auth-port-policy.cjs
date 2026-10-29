/* global module */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const PORT_NAMES = ['API', 'DB', 'SHADOW', 'MAILPIT', 'SMTP', 'POP3'];

/** @param {Record<string, string | undefined>} environment */
function validateIsolatedPorts(environment) {
  const ports = PORT_NAMES.map((name) => environment[`E2E_LOCAL_${name}_PORT`]);
  assert(ports.every((port) => typeof port === 'string' && /^[1-9][0-9]{3,4}$/.test(port)
    && Number(port) >= 1024 && Number(port) <= 65535 && Number(port) !== 3000), 'invalid isolated service port');
  assert(new Set(ports).size === PORT_NAMES.length, 'isolated service ports must be distinct');
  return ports;
}

module.exports = { PORT_NAMES, validateIsolatedPorts };
