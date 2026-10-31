-- Read-only aggregate inventory for the existing development project. This
-- returns table names and exact counts only; it never selects customer,
-- payment, wallet, or provider row contents. Execute only through the trusted
-- protected development environment with a bounded statement_timeout.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

SELECT 'auth.users' AS relation, count(*)::bigint AS row_count FROM auth.users
UNION ALL SELECT 'public.admins', count(*)::bigint FROM public.admins
UNION ALL SELECT 'public.announcements', count(*)::bigint FROM public.announcements
UNION ALL SELECT 'public.app_settings', count(*)::bigint FROM public.app_settings
UNION ALL SELECT 'public.checkout_policy', count(*)::bigint FROM public.checkout_policy
UNION ALL SELECT 'public.checkout_policy_audit', count(*)::bigint FROM public.checkout_policy_audit
UNION ALL SELECT 'public.customer_confirmation_resend_reservations', count(*)::bigint FROM public.customer_confirmation_resend_reservations
UNION ALL SELECT 'public.customer_profiles', count(*)::bigint FROM public.customer_profiles
UNION ALL SELECT 'public.email_sent_log', count(*)::bigint FROM public.email_sent_log
UNION ALL SELECT 'public.fazercards_webhook_events', count(*)::bigint FROM public.fazercards_webhook_events
UNION ALL SELECT 'public.game_input_fields', count(*)::bigint FROM public.game_input_fields
UNION ALL SELECT 'public.games', count(*)::bigint FROM public.games
UNION ALL SELECT 'public.global_announcement', count(*)::bigint FROM public.global_announcement
UNION ALL SELECT 'public.guest_order_access', count(*)::bigint FROM public.guest_order_access
UNION ALL SELECT 'public.guest_order_access_challenges', count(*)::bigint FROM public.guest_order_access_challenges
UNION ALL SELECT 'public.notifications', count(*)::bigint FROM public.notifications
UNION ALL SELECT 'public.order_email_outbox', count(*)::bigint FROM public.order_email_outbox
UNION ALL SELECT 'public.order_notes', count(*)::bigint FROM public.order_notes
UNION ALL SELECT 'public.order_timeline', count(*)::bigint FROM public.order_timeline
UNION ALL SELECT 'public.orders', count(*)::bigint FROM public.orders
UNION ALL SELECT 'public.packages', count(*)::bigint FROM public.packages
UNION ALL SELECT 'public.payment_config', count(*)::bigint FROM public.payment_config
UNION ALL SELECT 'public.payment_submissions', count(*)::bigint FROM public.payment_submissions
UNION ALL SELECT 'public.payment_transactions', count(*)::bigint FROM public.payment_transactions
UNION ALL SELECT 'public.player_cache', count(*)::bigint FROM public.player_cache
UNION ALL SELECT 'public.promotions', count(*)::bigint FROM public.promotions
UNION ALL SELECT 'public.refunds', count(*)::bigint FROM public.refunds
UNION ALL SELECT 'public.supplier_package_mappings', count(*)::bigint FROM public.supplier_package_mappings
UNION ALL SELECT 'public.supplier_test_runs', count(*)::bigint FROM public.supplier_test_runs
UNION ALL SELECT 'public.supplier_transactions', count(*)::bigint FROM public.supplier_transactions
UNION ALL SELECT 'public.suppliers', count(*)::bigint FROM public.suppliers
UNION ALL SELECT 'public.support_messages', count(*)::bigint FROM public.support_messages
UNION ALL SELECT 'public.support_tickets', count(*)::bigint FROM public.support_tickets
UNION ALL SELECT 'public.verification_attempts', count(*)::bigint FROM public.verification_attempts
UNION ALL SELECT 'public.verified_users', count(*)::bigint FROM public.verified_users
UNION ALL SELECT 'public.voucher_usages', count(*)::bigint FROM public.voucher_usages
UNION ALL SELECT 'public.vouchers', count(*)::bigint FROM public.vouchers
ORDER BY relation;

ROLLBACK;
