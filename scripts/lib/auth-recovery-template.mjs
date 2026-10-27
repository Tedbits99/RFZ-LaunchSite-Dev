#!/usr/bin/env node

import process from 'node:process';
import { URL } from 'node:url';

const TOKEN_HASH_PLACEHOLDER = '{{ .TokenHash }}';
const REDIRECT_TO_PLACEHOLDER = '{{ .RedirectTo }}';
const CANONICAL_RECOVERY_HREF = `${REDIRECT_TO_PLACEHOLDER}?token_hash=${TOKEN_HASH_PLACEHOLDER}&amp;type=recovery`;

function trustedCallback(callbackUrl) {
  try {
    const callback = new URL(callbackUrl);
    return callback.protocol === 'https:'
      && !callback.username
      && !callback.password
      && /^pr(?:69|82)-[0-9a-f]{12}-runfazone-preview\.mondigoted732\.workers\.dev$/i.test(callback.hostname)
      && callback.pathname === '/auth/callback'
      && callback.search === ''
      && callback.hash === '';
  } catch {
    return false;
  }
}

function recoveryAnchors(template) {
  const anchors = [];
  const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  let match;
  let index = 0;
  while ((match = anchorPattern.exec(template)) !== null) {
    const anchorIndex = index++;
    const hrefMatch = match[0].match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[2];
    if (/\{\{\s*\.(?:RedirectTo|ConfirmationURL|TokenHash)\s*\}\}/i.test(href)
      || /token[_-]?hash/i.test(href)) {
      const hrefStart = match.index + hrefMatch.index + hrefMatch[0].indexOf(href);
      const label = match[0].slice(match[0].indexOf('>') + 1).replace(/<[^>]*>/g, ' ');
      anchors.push({
        index: anchorIndex,
        start: hrefStart,
        end: hrefStart + href.length,
        href,
        label,
      });
    }
  }
  return anchors;
}

/** Return only structural booleans/counts. Never return template text or URLs. */
export function inspectRecoveryTemplate(template) {
  if (typeof template !== 'string') {
    return { validInput: false, anchorCount: 0, authLinkCount: 0, links: [] };
  }
  const anchorCount = [...template.matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)].length;
  const authLinks = recoveryAnchors(template);
  return {
    validInput: true,
    anchorCount,
    authLinkCount: authLinks.length,
    links: authLinks.map(({ index, href, label }) => ({
      index,
      redirectTo: /\{\{\s*\.RedirectTo\s*\}\}/i.test(href),
      confirmationUrl: /\{\{\s*\.ConfirmationURL\s*\}\}/i.test(href),
      tokenHashVariable: /\{\{\s*\.TokenHash\s*\}\}/i.test(href),
      tokenHashLiteral: /token[_-]?hash/i.test(href),
      resetLabel: /reset/i.test(label),
      passwordLabel: /password/i.test(label),
      recoveryLabel: /recover/i.test(label),
      redirectSeparator: (() => {
        const match = href.match(/\{\{\s*\.RedirectTo\s*\}\}([\s\S])?/i);
        return match?.[1] === '?' || match?.[1] === '&' || match?.[1] === '/' ? match[1] : 'other_or_absent';
      })(),
      canonical: href === CANONICAL_RECOVERY_HREF,
    })),
  };
}

/** Replace only the recovery link's href, preserving the branded HTML around it. */
export function repairRecoveryTemplate(template, callbackUrl) {
  if (typeof template !== 'string' || !template.trim() || !trustedCallback(callbackUrl)) {
    throw new Error('invalid recovery template input');
  }
  const anchors = recoveryAnchors(template);
  if (anchors.length === 0) throw new Error('recovery link is missing');
  let repaired = template;
  for (const anchor of [...anchors].sort((left, right) => right.start - left.start)) {
    repaired = `${repaired.slice(0, anchor.start)}${CANONICAL_RECOVERY_HREF}${repaired.slice(anchor.end)}`;
  }
  return repaired;
}

/** Validate the actual rendered URL shape using a synthetic, redacted token. */
export function validateRecoveryTemplate(template, callbackUrl) {
  if (typeof template !== 'string' || !trustedCallback(callbackUrl)) {
    return { valid: false, reason: 'invalid_callback_or_template' };
  }
  const anchors = recoveryAnchors(template);
  if (anchors.length === 0 || anchors.some((anchor) => anchor.href !== CANONICAL_RECOVERY_HREF)) {
    return { valid: false, reason: 'recovery_href_contract_mismatch' };
  }

  const renderedHref = anchors[0].href
    .replace(REDIRECT_TO_PLACEHOLDER, callbackUrl)
    .replace(TOKEN_HASH_PLACEHOLDER, 'synthetic-token-hash')
    .replace(/&amp;/gi, '&');
  try {
    const rendered = new URL(renderedHref);
    const entries = [...rendered.searchParams.entries()];
    const valid = rendered.protocol === 'https:'
      && rendered.origin === new URL(callbackUrl).origin
      && rendered.pathname === '/auth/callback'
      && rendered.username === ''
      && rendered.password === ''
      && rendered.hash === ''
      && entries.length === 2
      && rendered.searchParams.get('token_hash') === 'synthetic-token-hash'
      && rendered.searchParams.get('type') === 'recovery';
    return { valid, reason: valid ? 'valid' : 'rendered_url_contract_mismatch' };
  } catch {
    return { valid: false, reason: 'rendered_url_invalid' };
  }
}

async function readStdin() {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const mode = process.argv[2];
  const callbackUrl = process.argv[3] ?? '';
  const template = await readStdin();
  try {
    if (mode === 'repair') {
      process.stdout.write(repairRecoveryTemplate(template, callbackUrl));
    } else if (mode === 'validate') {
      process.stdout.write(`${JSON.stringify(validateRecoveryTemplate(template, callbackUrl))}\n`);
    } else if (mode === 'inspect') {
      process.stdout.write(`${JSON.stringify(inspectRecoveryTemplate(template))}\n`);
    } else {
      process.stderr.write('Usage: auth-recovery-template.mjs <repair|validate|inspect> <trusted-callback-url>\n');
      process.exitCode = 2;
    }
  } catch {
    process.stderr.write('BLOCKED: hosted recovery template does not contain exactly one safe recovery link.\n');
    process.exitCode = 1;
  }
}
