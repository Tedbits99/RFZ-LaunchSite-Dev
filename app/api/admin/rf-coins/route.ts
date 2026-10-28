import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { rfCoinErrorMessage } from '@/lib/rfCoins';
import { RF_COINS_FUNDING_RELEASE_ENABLED, RF_COINS_SPENDING_RELEASE_ENABLED } from '@/lib/rfCoinFundingRelease';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;
const MAX_REPORT_DAYS = 90;
const EXPORT_PAGE_SIZE = 50;
const MAX_EXPORT_ROWS = 1000;
const TOPUP_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'];
const EXPORTS = {
  wallets: [
    ['user_id', 'Customer user ID'], ['balance_coins', 'Balance (RF)'],
    ['total_purchased_coins', 'Purchased (RF)'], ['total_spent_coins', 'Spent (RF)'],
    ['total_manual_credited_coins', 'Manual credits (RF)'], ['total_manual_debited_coins', 'Manual debits (RF)'],
    ['total_reversed_coins', 'Reversed (RF)'], ['created_at', 'Wallet created UTC'], ['updated_at', 'Wallet updated UTC'],
  ],
  topups: [
    ['id', 'Top-up ID'], ['user_id', 'Customer user ID'], ['package_id', 'Package ID'], ['package_name', 'Package name'],
    ['coins', 'Base coins (RF)'], ['bonus_coins', 'Bonus coins (RF)'], ['price_cents', 'Price (PHP centavos)'],
    ['provider', 'Provider'], ['provider_reference', 'Provider reference (masked)'], ['status', 'Status'],
    ['payment_verified_at', 'Payment verified UTC'], ['credited_at', 'Credited UTC'], ['credited_total', 'Credited total (RF)'],
    ['reversed_total', 'Reversed total (RF)'], ['created_at', 'Created UTC'], ['updated_at', 'Updated UTC'],
  ],
  ledger: [
    ['id', 'Ledger ID'], ['wallet_user_id', 'Customer user ID'], ['direction', 'Direction'], ['amount_coins', 'Amount (RF)'],
    ['kind', 'Kind'], ['balance_after', 'Balance after (RF)'], ['reference_type', 'Reference type'],
    ['reference_id', 'Reference ID'], ['created_at', 'Created UTC'],
  ],
  adjustments: [
    ['id', 'Request ID'], ['target_user_id', 'Customer user ID'], ['direction', 'Direction'], ['amount_coins', 'Amount (RF)'],
    ['category', 'Category'], ['status', 'Status'], ['requested_by', 'Requested by admin ID'],
    ['is_high_value', 'High value'], ['created_at', 'Created UTC'], ['updated_at', 'Updated UTC'],
  ],
  audit: [
    ['id', 'Audit ID'], ['actor_admin_id', 'Admin ID'], ['action', 'Action'], ['target_user_id', 'Customer user ID'],
    ['entity_type', 'Entity type'], ['entity_id', 'Entity ID'], ['created_at', 'Created UTC'],
  ],
  exceptions: [
    ['alert_key', 'Alert key'], ['severity', 'Severity'], ['category', 'Category'], ['entity_type', 'Entity type'],
    ['entity_id', 'Entity ID'], ['target_user_id', 'Customer user ID'], ['summary', 'Summary'], ['occurred_at', 'Occurred UTC'],
  ],
} as const;
type ExportType = keyof typeof EXPORTS;
const EXPORT_GROUP: Record<ExportType, string> = {
  wallets: 'wallets', topups: 'topups', ledger: 'ledger', adjustments: 'adjustmentRequests', audit: 'audit', exceptions: 'exceptions',
};

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Prefix spreadsheet formula-like content even when preceded by whitespace.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function maskProviderReference(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  return value.length <= 6 ? '[redacted]' : `…${value.slice(-6)}`;
}

function toCsv(type: ExportType, rows: Record<string, unknown>[]): string {
  const columns = EXPORTS[type];
  const header = columns.map(([, label]) => csvCell(label)).join(',');
  const body = rows.map((row) => columns.map(([key]) => {
    const value = type === 'topups' && key === 'provider_reference'
      ? maskProviderReference(row[key])
      : row[key];
    return csvCell(value);
  }).join(','));
  return `${[header, ...body].join('\r\n')}\r\n`;
}

function unavailable(error?: { code?: string; message?: string } | null) {
  if (error?.code === 'PGRST202' || error?.code === 'PGRST205' || error?.code === '42P01' || error?.code === '42883') {
    return NextResponse.json({
      error: 'RF Coins has not been configured for this environment.',
      guidance: 'The RF Coins database migrations are staged but have not been applied. No financial data or actions are available here.',
      configured: false,
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ error: 'RF Coins reporting is temporarily unavailable. No totals are being assumed.' }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function parseRange(params: URLSearchParams): { from: string; to: string } | { error: string } {
  const to = params.get('to') ? new Date(params.get('to')!) : new Date();
  const from = params.get('from') ? new Date(params.get('from')!) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return { error: 'Choose a valid UTC date range.' };
  }
  if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * 24 * 60 * 60 * 1000) {
    return { error: 'Reporting ranges are limited to 90 days.' };
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;
  if (session.session.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'RF Coins financial access requires an active Super Admin.' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const page = Number(params.get('page') || '1');
  const search = (params.get('search') || '').trim();
  const walletUserId = params.get('wallet_id');
  const topupStatus = params.get('topup_status');
  const walletStatus = params.get('wallet_status') || 'all';
  const provider = params.get('provider');
  const exportValue = params.get('export');
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 100) {
    return NextResponse.json({ error: 'Invalid report page or search query.' }, { status: 400 });
  }
  if (walletUserId && !UUID_RE.test(walletUserId)) {
    return NextResponse.json({ error: 'Invalid wallet identifier.' }, { status: 400 });
  }
  if (topupStatus && !TOPUP_STATUSES.includes(topupStatus)) {
    return NextResponse.json({ error: 'Invalid top-up status filter.' }, { status: 400 });
  }
  if (!['all', 'zero', 'nonzero'].includes(walletStatus)
    || provider !== null && (provider.length > 60 || !/^[a-zA-Z0-9_-]+$/.test(provider))) {
    return NextResponse.json({ error: 'Invalid wallet balance filter.' }, { status: 400 });
  }
  const range = parseRange(params);
  if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 });

  try {
    if (exportValue !== null) {
      if (!Object.prototype.hasOwnProperty.call(EXPORTS, exportValue)) {
        return NextResponse.json({ error: 'Unsupported RF Coins export type.' }, { status: 400 });
      }
      const exportType = exportValue as ExportType;
      const groupName = EXPORT_GROUP[exportType];
      const rowsToExport: Record<string, unknown>[] = [];
      let total = 0;

      for (let reportPage = 1; reportPage <= Math.ceil(MAX_EXPORT_ROWS / EXPORT_PAGE_SIZE); reportPage += 1) {
        const { data, error } = await session.client.rpc('rf_coin_admin_center_read', {
          p_search: search || null,
          p_page: reportPage,
          p_page_size: EXPORT_PAGE_SIZE,
          p_wallet_user_id: walletUserId || null,
          p_from: range.from,
          p_to: range.to,
          p_topup_status: topupStatus,
          p_wallet_status: walletStatus,
          p_provider: provider,
        });
        if (error) {
          if (error.code === '42501') return NextResponse.json({ error: 'RF Coins financial access is not authorized.' }, { status: 403 });
          return unavailable(error);
        }
        const report = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
        const group = report?.[groupName] as { rows?: unknown[]; total?: string | number } | undefined;
        if (!group || !Array.isArray(group.rows)) return unavailable();
        if (reportPage === 1) {
          total = Number(group.total);
          if (!Number.isSafeInteger(total) || total < 0) return unavailable();
          if (total > MAX_EXPORT_ROWS) {
            return NextResponse.json({ error: `This export contains ${total} rows. Narrow the search or date range to 1,000 rows or fewer.` }, { status: 413 });
          }
        }
        rowsToExport.push(...group.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object'));
        if (rowsToExport.length >= total || group.rows.length < EXPORT_PAGE_SIZE) break;
      }

      if (rowsToExport.length !== total) return unavailable();
      const { error: auditError } = await session.client.rpc('rf_coin_record_admin_export', {
        p_export_type: exportType,
        p_row_count: rowsToExport.length,
        p_from: range.from,
        p_to: range.to,
      });
      if (auditError) return unavailable(auditError);

      const date = new Date().toISOString().slice(0, 10);
      return new NextResponse(toCsv(exportType, rowsToExport), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="rf-coins-${exportType}-${date}.csv"`,
          'X-Exported-Rows': String(rowsToExport.length),
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // The JWT-authenticated RPC rechecks the active SUPER_ADMIN row in
    // Postgres. This avoids service-role table scans and gives the report a
    // bounded page plus exact aggregate values from the database.
    const { data, error } = await session.client.rpc('rf_coin_admin_center_read', {
      p_search: search || null,
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_wallet_user_id: walletUserId || null,
      p_from: range.from,
      p_to: range.to,
      p_topup_status: topupStatus,
      p_wallet_status: walletStatus,
      p_provider: provider,
    });
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'RF Coins financial access is not authorized.' }, { status: 403 });
      return unavailable(error);
    }
    const report = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!report || typeof report !== 'object') return unavailable();

    const settings = report.settings as Record<string, unknown> | null;
    const effectiveSettings = settings ? {
      ...settings,
      database_topups_enabled: settings.topups_enabled === true,
      database_spending_enabled: settings.spending_enabled === true,
      // App and database release locks remain off. DB toggles cannot make
      // funding or wallet spending operational in this release.
      topups_enabled: RF_COINS_FUNDING_RELEASE_ENABLED && settings.topups_enabled === true,
      spending_enabled: RF_COINS_SPENDING_RELEASE_ENABLED && settings.spending_enabled === true,
      funding_release_locked: !RF_COINS_FUNDING_RELEASE_ENABLED,
      spending_release_locked: !RF_COINS_SPENDING_RELEASE_ENABLED,
    } : null;
    const rows = (key: string) => {
      const group = report[key] as { rows?: unknown[]; total?: number } | undefined;
      return { rows: Array.isArray(group?.rows) ? group!.rows! : [], total: Number(group?.total || 0) };
    };
    const wallets = rows('wallets');
    const topups = rows('topups');
    const ledger = rows('ledger');
    const adjustmentRequests = rows('adjustmentRequests');
    const packages = rows('packages');
    const audit = rows('audit');
    const exceptions = rows('exceptions');

    return NextResponse.json({
      configured: true,
      settings: effectiveSettings,
      metrics: report.metrics,
      wallets: wallets.rows,
      topups: topups.rows,
      ledger: ledger.rows,
      adjustmentRequests: adjustmentRequests.rows,
      packages: packages.rows,
      audit: audit.rows,
      exceptions: exceptions.rows,
      trend: report.trend,
      topupTrend: report.topupTrend,
      walletDistribution: report.walletDistribution,
      pendingAging: report.pendingAging,
      range: report.range,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalWallets: wallets.total,
        totalTopups: topups.total,
        totalLedger: ledger.total,
        totalAdjustmentRequests: adjustmentRequests.total,
        totalPackages: packages.total,
        totalAudit: audit.total,
        totalExceptions: exceptions.total,
      },
      release: { fundingEnabled: RF_COINS_FUNDING_RELEASE_ENABLED, spendingEnabled: RF_COINS_SPENDING_RELEASE_ENABLED },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'RF Coins reporting is temporarily unavailable. No totals are being assumed.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;
  if (session.session.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Super Admin role required.' }, { status: 403 });
  }
  const adminClient = session.client;

  try {
    const body: Record<string, unknown> = await req.json();
    const action = body.action;

    if (action === 'settings') {
      if (body.enabled === true || body.topups_enabled === true || body.spending_enabled === true) {
        return NextResponse.json({ error: 'Wallet funding is awaiting financial release approval.' }, { status: 423 });
      }
      const rate = body.centavos_per_coin;
      const threshold = body.high_value_adjustment_coins;
      const dailyLimit = body.max_daily_admin_adjustments;
      if (rate !== undefined && (!Number.isSafeInteger(rate) || Number(rate) < 1 || Number(rate) > 100000000)
        || threshold !== undefined && (!Number.isSafeInteger(threshold) || Number(threshold) < 1 || Number(threshold) > 1000000)
        || dailyLimit !== undefined && (!Number.isSafeInteger(dailyLimit) || Number(dailyLimit) < 1 || Number(dailyLimit) > 1000)) {
        return NextResponse.json({ error: 'Settings values are outside supported limits.' }, { status: 400 });
      }
      const { error } = await adminClient.rpc('rf_coin_set_settings', {
        p_enabled: body.enabled ?? null,
        p_topups_enabled: body.topups_enabled ?? null,
        p_spending_enabled: body.spending_enabled ?? null,
        p_centavos_per_coin: rate ?? null,
        p_high_value_adjustment_coins: threshold ?? null,
        p_max_daily_admin_adjustments: dailyLimit ?? null,
      });
      if (error) return error.code === 'PGRST202' ? unavailable(error) : NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Settings update failed.') }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'adjustment') {
      const amount = body.amount_coins;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
      if (typeof body.target_user_id !== 'string' || !UUID_RE.test(body.target_user_id)
        || !['credit', 'debit'].includes(String(body.direction))
        || !Number.isSafeInteger(amount) || Number(amount) < 1 || Number(amount) > 1000000
        || !['promotion', 'compensation', 'correction'].includes(String(body.category))
        || reason.length < 3 || reason.length > 1000
        || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
        return NextResponse.json({ error: 'Adjustment request is invalid.' }, { status: 400 });
      }
      const { data, error } = await adminClient.rpc('rf_coin_request_adjustment', {
        p_target_user_id: body.target_user_id,
        p_direction: body.direction,
        p_amount_coins: amount,
        p_reason: reason,
        p_category: body.category,
        p_idempotency_key: idempotencyKey,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Adjustment failed.') }, { status: 400 });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.out_error) return NextResponse.json({ error: rfCoinErrorMessage(row.out_error, 'Adjustment failed.') }, { status: 400 });
      return NextResponse.json({ ok: true, requestId: row?.out_request_id, status: row?.out_status });
    }

    if (action === 'decide') {
      if (typeof body.request_id !== 'string' || !UUID_RE.test(body.request_id) || typeof body.approve !== 'boolean'
        || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000))) {
        return NextResponse.json({ error: 'Adjustment decision is invalid.' }, { status: 400 });
      }
      const { data, error } = await adminClient.rpc('rf_coin_decide_adjustment', {
        p_request_id: body.request_id,
        p_approve: body.approve,
        p_note: typeof body.note === 'string' ? body.note.trim() : null,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Decision failed.') }, { status: 400 });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.out_error) return NextResponse.json({ error: rfCoinErrorMessage(row.out_error, 'Decision failed.') }, { status: 400 });
      return NextResponse.json({ ok: true, status: row?.out_status });
    }

    if (action === 'package') {
      const name = body.name;
      const coins = body.coins;
      const bonus = body.bonus_coins;
      const price = body.price_cents;
      const sortOrder = body.sort_order;
      if (body.package_id !== undefined && (typeof body.package_id !== 'string' || !UUID_RE.test(body.package_id))
        || name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80)
        || coins !== undefined && (!Number.isSafeInteger(coins) || Number(coins) < 1 || Number(coins) > 10000000)
        || bonus !== undefined && (!Number.isSafeInteger(bonus) || Number(bonus) < 0 || Number(bonus) > 10000000)
        || price !== undefined && (!Number.isSafeInteger(price) || Number(price) < 1 || Number(price) > 100000000)
        || sortOrder !== undefined && (!Number.isSafeInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 100000)
        || body.is_active !== undefined && typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'Coin package values are invalid.' }, { status: 400 });
      }
      const { data, error } = await adminClient.rpc('rf_coin_upsert_package', {
        p_package_id: body.package_id || null,
        p_name: typeof name === 'string' ? name.trim() : null,
        p_coins: coins ?? null,
        p_bonus_coins: bonus ?? null,
        p_price_cents: price ?? null,
        p_is_active: body.is_active ?? null,
        p_sort_order: sortOrder ?? null,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Package update failed.') }, { status: 400 });
      return NextResponse.json({ ok: true, packageId: data });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Request could not be processed.' }, { status: 400 });
  }
}
