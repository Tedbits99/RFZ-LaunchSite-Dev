import { describe, expect, it } from 'vitest';
import {
  isWalletTopupReminderSnoozed,
  shouldShowWalletTopupReminder,
  WALLET_TOPUP_REMINDER_SNOOZE_MS,
  walletTopupReminderSnoozeUntil,
} from './walletTopupReminder';

describe('wallet top-up reminder snooze', () => {
  it('persists dismissal for at least seven days', () => {
    const now = 1_800_000_000_000;
    const until = Number(walletTopupReminderSnoozeUntil(now));
    expect(until - now).toBe(WALLET_TOPUP_REMINDER_SNOOZE_MS);
    expect(isWalletTopupReminderSnoozed(String(until), until - 1)).toBe(true);
    expect(isWalletTopupReminderSnoozed(String(until), until)).toBe(false);
  });

  it('fails open for stale or malformed browser storage values', () => {
    expect(isWalletTopupReminderSnoozed(null, 100)).toBe(false);
    expect(isWalletTopupReminderSnoozed('not-a-timestamp', 100)).toBe(false);
    expect(isWalletTopupReminderSnoozed('99', 100)).toBe(false);
  });

  it('shows only for a real short balance while server-approved funding is available', () => {
    const eligible = { fundingAvailable: true, walletOptionSelected: true, balance: 25, requiredCoins: 40, snoozed: false };
    expect(shouldShowWalletTopupReminder(eligible)).toBe(true);
    expect(shouldShowWalletTopupReminder({ ...eligible, fundingAvailable: false })).toBe(false);
    expect(shouldShowWalletTopupReminder({ ...eligible, walletOptionSelected: false })).toBe(false);
    expect(shouldShowWalletTopupReminder({ ...eligible, balance: null })).toBe(false);
    expect(shouldShowWalletTopupReminder({ ...eligible, requiredCoins: 20 })).toBe(false);
    expect(shouldShowWalletTopupReminder({ ...eligible, snoozed: true })).toBe(false);
  });
});
