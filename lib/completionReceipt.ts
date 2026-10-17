import { getConfiguredAppOrigin } from '@/lib/authRedirect';

export type CompletionReceiptInput = {
  publicOrderReference: string;
  gameName: string;
  packageName: string;
  quantity: number;
  playerIdentifier: string;
  paymentMethod: string;
  totalCents: number;
  completedAt: string | Date;
};

export type CompletionReceipt = {
  subject: string;
  html: string;
  text: string;
};

const MAX_TEXT_LENGTH = 320;
const VIEW_ORDER_PATH = '/track-order';

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('Completion receipt rendering is server-only.');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function validateText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid completion receipt ${field}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TEXT_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Invalid completion receipt ${field}.`);
  }
  return normalized;
}

function maskPlayerIdentifier(identifier: string): string {
  if (identifier.length <= 4) return '*'.repeat(identifier.length);
  return `${'*'.repeat(identifier.length - 4)}${identifier.slice(-4)}`;
}

function formatAmount(totalCents: number): string {
  return `₱${(totalCents / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPaymentMethod(paymentMethod: string): string {
  const knownLabels: Record<string, string> = {
    gcash: 'GCash',
    maya: 'Maya',
    'coins.ph': 'Coins.ph',
    paymongo: 'PayMongo',
    qrph: 'QRPh',
  };
  const knownLabel = knownLabels[paymentMethod.toLowerCase()];
  if (knownLabel) return knownLabel;

  return paymentMethod
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCompletionTime(completedAt: string | Date): string {
  const date = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid completion receipt completedAt.');

  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function validateInput(input: CompletionReceiptInput): {
  reference: string;
  gameName: string;
  packageName: string;
  quantity: number;
  maskedPlayerId: string;
  paymentMethod: string;
  amount: string;
  completedAt: string;
  viewOrderUrl: string;
} {
  assertServer();
  if (!input || typeof input !== 'object') throw new Error('Invalid completion receipt input.');

  const reference = validateText(input.publicOrderReference, 'order reference');
  if (!/^RF-[A-Z0-9-]+$/i.test(reference)) {
    throw new Error('Invalid completion receipt order reference.');
  }
  const gameName = validateText(input.gameName, 'game name');
  const packageName = validateText(input.packageName, 'package name');
  const playerIdentifier = validateText(input.playerIdentifier, 'player identifier');
  const paymentMethod = validateText(input.paymentMethod, 'payment method');

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000) {
    throw new Error('Invalid completion receipt quantity.');
  }
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents < 0) {
    throw new Error('Invalid completion receipt amount.');
  }

  const completedAt = formatCompletionTime(input.completedAt);
  const origin = getConfiguredAppOrigin();
  if (!origin) throw new Error('Completion receipt application origin is unavailable.');

  return {
    reference,
    gameName,
    packageName,
    quantity: input.quantity,
    maskedPlayerId: maskPlayerIdentifier(playerIdentifier),
    paymentMethod: formatPaymentMethod(paymentMethod),
    amount: formatAmount(input.totalCents),
    completedAt,
    viewOrderUrl: `${origin}${VIEW_ORDER_PATH}?ref=${encodeURIComponent(reference)}`,
  };
}

export function renderCompletionReceipt(input: CompletionReceiptInput): CompletionReceipt {
  const values = validateInput(input);
  const h = {
    reference: escapeHtml(values.reference),
    gameName: escapeHtml(values.gameName),
    packageName: escapeHtml(values.packageName),
    maskedPlayerId: escapeHtml(values.maskedPlayerId),
    paymentMethod: escapeHtml(values.paymentMethod),
    amount: escapeHtml(values.amount),
    completedAt: escapeHtml(values.completedAt),
    viewOrderUrl: escapeHtml(values.viewOrderUrl),
  };
  const textValues = {
    reference: values.reference,
    gameName: values.gameName,
    packageName: values.packageName,
    maskedPlayerId: values.maskedPlayerId,
    paymentMethod: values.paymentMethod,
    amount: values.amount,
    completedAt: values.completedAt,
    viewOrderUrl: values.viewOrderUrl,
  };

  return {
    subject: `Top-Up Successful — ${values.reference}`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#030718;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#030718;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
          <tr><td style="padding:12px 16px 20px;background:#0b1226;border-bottom:3px solid #7c3aed;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-.4px;">Run<span style="color:#18c8ff;">Fazone</span></td></tr>
          <tr><td style="background:#ffffff;border:1px solid #dbe4ef;border-radius:16px;padding:32px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" style="padding-bottom:16px;"><span style="display:inline-block;width:40px;height:40px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:25px;line-height:40px;font-weight:700;">✓</span></td></tr>
              <tr><td align="center" style="color:#0f172a;font-size:28px;line-height:34px;font-weight:700;">Top-Up Successful</td></tr>
              <tr><td align="center" style="padding:10px 0 24px;color:#475569;font-size:15px;line-height:23px;">Your top-up has been completed successfully.</td></tr>
              <tr><td align="center" style="padding:16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;"><span style="display:block;color:#64748b;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;">Order reference</span><strong style="display:block;padding-top:6px;color:#2563eb;font-size:22px;letter-spacing:1px;">${h.reference}</strong></td></tr>
              <tr><td style="padding-top:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Game</td><td align="right" style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${h.gameName}</td></tr>
                <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Package</td><td align="right" style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${h.packageName}</td></tr>
                <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Quantity</td><td align="right" style="padding:7px 0;color:#0f172a;font-size:14px;">${values.quantity}</td></tr>
                <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Player ID</td><td align="right" style="padding:7px 0;color:#0f172a;font-size:14px;font-family:monospace;">${h.maskedPlayerId}</td></tr>
                <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Payment method</td><td align="right" style="padding:7px 0;color:#0f172a;font-size:14px;">${h.paymentMethod}</td></tr>
                <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Completed</td><td align="right" style="padding:7px 0;color:#0f172a;font-size:14px;">${h.completedAt}</td></tr>
              </table></td></tr>
              <tr><td style="padding-top:22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eff6ff;border-radius:10px;"><tr><td style="padding:16px 18px;color:#1e3a8a;font-size:13px;">Amount paid</td><td align="right" style="padding:16px 18px;color:#2563eb;font-size:22px;font-weight:700;">${h.amount}</td></tr></table></td></tr>
              <tr><td align="center" style="padding:28px 0 8px;"><a href="${h.viewOrderUrl}" style="display:inline-block;background:#2563eb;border-radius:8px;color:#ffffff;font-size:15px;font-weight:700;padding:14px 28px;text-decoration:none;">View Your Order</a></td></tr>
              <tr><td align="center" style="padding-top:14px;color:#64748b;font-size:12px;line-height:19px;">The order page will ask for the existing verification details before showing private information.</td></tr>
            </table>
          </td></tr>
          <tr><td align="center" style="padding:22px 16px;background:#0b1226;color:#cbd5e1;font-size:12px;line-height:19px;">Run<span style="color:#18c8ff;font-weight:700;">Fazone</span><br>This is a transactional top-up completion receipt.<br>For help with this order, contact <a href="mailto:orders@runfazone.com" style="color:#18c8ff;text-decoration:none;">orders@runfazone.com</a><br><span style="color:#94a3b8;">© 2026 RunFazone. All rights reserved.</span></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    text: `Top-Up Successful — RunFazone

Your top-up has been completed successfully.

Order reference: ${textValues.reference}
Game: ${textValues.gameName}
Package: ${textValues.packageName}
Quantity: ${values.quantity}
Player ID: ${textValues.maskedPlayerId}
Payment method: ${textValues.paymentMethod}
Completed: ${textValues.completedAt}
Amount paid: ${textValues.amount}

View Your Order: ${textValues.viewOrderUrl}

RunFazone
This is a transactional top-up completion receipt.
For help with this order, contact orders@runfazone.com
© 2026 RunFazone. All rights reserved.`,
  };
}
