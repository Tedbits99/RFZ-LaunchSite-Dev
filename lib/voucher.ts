import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';

function db() {
  return adminSupabase || supabase;
}

export type VoucherRow = {
  id: string;
  code: string;
  description: string;
  discount_type: 'PERCENTAGE' | 'FIXED';
  discount_value: number;
  min_order_cents: number;
  max_discount_cents: number | null;
  usage_limit: number | null;
  per_user_limit: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  applies_to_game_id: string | null;
  created_at: string;
};

export type ValidationResult =
  | { valid: false; error: string }
  | {
      valid: true;
      voucher: VoucherRow;
      subtotal_cents: number;
      discount_cents: number;
      total_cents: number;
    };

export type ConsumeResult =
  | { success: false; error: string }
  | {
      success: true;
      voucher_id: string;
      code: string;
      discount_type: string;
      discount_value: number;
      discount_cents: number;
      subtotal_cents: number;
      total_cents: number;
    };

export function computeDiscount(
  voucher: Pick<VoucherRow, 'discount_type' | 'discount_value' | 'max_discount_cents'>,
  subtotalCents: number
): number {
  let discount = 0;
  if (voucher.discount_type === 'PERCENTAGE') {
    discount = Math.round((subtotalCents * voucher.discount_value) / 100);
    if (voucher.max_discount_cents != null && voucher.max_discount_cents >= 0) {
      discount = Math.min(discount, voucher.max_discount_cents);
    }
  } else {
    discount = voucher.discount_value;
  }
  discount = Math.min(discount, subtotalCents);
  discount = Math.max(discount, 0);
  return discount;
}

export async function validateVoucher(params: {
  code: string;
  subtotalCents: number;
  gameId?: string;
  email?: string;
}): Promise<ValidationResult> {
  const { code, subtotalCents, gameId, email } = params;
  const client = db();
  if (!client) {
    return { valid: false, error: 'Voucher service is temporarily unavailable.' };
  }
  const normalized = (code || '').trim().toUpperCase();
  if (!normalized || normalized.length > 50) {
    return { valid: false, error: 'Invalid voucher code.' };
  }

  // The vouchers table is denied to non-admin roles, so all validation
  // goes through the SECURITY DEFINER function — the same rules the
  // atomic create_order function enforces.
  const { data, error } = await client.rpc('validate_voucher', {
    p_code: normalized,
    p_subtotal_cents: subtotalCents,
    p_game_id: gameId || null,
    p_email: email ? email.trim().toLowerCase() : null,
  });

  if (error) {
    return { valid: false, error: 'Could not check this voucher. Please try again.' };
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | { out_valid: boolean; out_error: string | null; out_discount_cents: number; out_total_cents: number; out_voucher: VoucherRow | null }
    | undefined;

  if (!result) {
    return { valid: false, error: 'Could not check this voucher. Please try again.' };
  }

  if (!result.out_valid) {
    return { valid: false, error: result.out_error || 'Invalid voucher code.' };
  }

  return {
    valid: true,
    voucher: result.out_voucher as unknown as VoucherRow,
    subtotal_cents: subtotalCents,
    discount_cents: result.out_discount_cents,
    total_cents: result.out_total_cents,
  };
}

export async function consumeVoucherForOrder(params: {
  code: string;
  subtotalCents: number;
  gameId: string;
  email: string;
  orderId: string;
}): Promise<ConsumeResult> {
  const { code, subtotalCents, gameId, email, orderId } = params;
  const client = db();
  if (!client) {
    return { success: false, error: 'Voucher service is temporarily unavailable.' };
  }

  const validation = await validateVoucher({ code, subtotalCents, gameId, email });
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const v = validation.voucher;
  const discountCents = validation.discount_cents;
  const totalCents = validation.total_cents;

  // Record the usage first with the authoritative amounts. The unique
  // constraint on (voucher_id, order_id) makes retries idempotent.
  const { error: usageError } = await client
    .from('voucher_usages')
    .upsert({
      voucher_id: v.id,
      order_id: orderId,
      email,
    }, { onConflict: 'voucher_id,order_id' });

  if (usageError) {
    const msg = String(usageError.message || '');
    if (msg.includes('usage_limit')) {
      return { success: false, error: 'This voucher has reached its usage limit.' };
    }
    if (msg.includes('per_user_limit')) {
      return { success: false, error: 'You have already used this voucher.' };
    }
    return { success: false, error: 'This voucher is no longer available. Please apply another voucher.' };
  }

  return {
    success: true,
    voucher_id: v.id,
    code: v.code,
    discount_type: v.discount_type,
    discount_value: v.discount_value,
    discount_cents: discountCents,
    subtotal_cents: subtotalCents,
    total_cents: totalCents,
  };
}

export function generateRandomCode(prefix = 'RFZ'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `${prefix.toUpperCase()}-${suffix}`;
}
