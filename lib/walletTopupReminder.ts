export const WALLET_TOPUP_REMINDER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export const WALLET_TOPUP_REMINDER_STORAGE_KEY = 'rfz-wallet-topup-reminder-snoozed-until';

export function isWalletTopupReminderSnoozed(value: string | null, now = Date.now()): boolean {
  if (!value) return false;
  const until = Number(value);
  return Number.isFinite(until) && until > now;
}

export function walletTopupReminderSnoozeUntil(now = Date.now()): string {
  return String(now + WALLET_TOPUP_REMINDER_SNOOZE_MS);
}

export function shouldShowWalletTopupReminder(input: {
  fundingAvailable: boolean;
  walletOptionSelected: boolean;
  balance: number | null;
  requiredCoins: number | null;
  snoozed: boolean;
}): boolean {
  return input.fundingAvailable
    && input.walletOptionSelected
    && !input.snoozed
    && input.balance !== null
    && Number.isSafeInteger(input.balance)
    && input.balance >= 0
    && input.requiredCoins !== null
    && Number.isSafeInteger(input.requiredCoins)
    && input.requiredCoins > input.balance;
}
