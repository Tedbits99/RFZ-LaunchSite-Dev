/*
# Email sent log — duplicate email prevention

## Purpose
Tracks every transactional email sent so both the PayMongo webhook Edge Function
and the admin verify-payment Next.js route can check "has this email already been
sent for this order + template?" before sending. Prevents duplicate emails from
duplicate webhooks or repeated admin actions.

## New table: email_sent_log
- id (uuid, primary key)
- order_id (uuid, references orders, nullable for non-order emails)
- template (text, not null) — e.g. 'payment_success', 'fulfillment_failed'
- recipient (text, not null) — customer email address
- sent_at (timestamptz, default now())
- Unique constraint on (order_id, template) so each order gets at most one
  email per template type — the database enforces the "once per order" rule
  even under concurrent webhook duplicates.

## Security
- RLS enabled.
- No direct client access — only the service role (edge functions and server
  routes) reads/writes this table. No anon or authenticated policies are added,
  so the table is locked to all non-service-role clients.
*/

CREATE TABLE IF NOT EXISTS email_sent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  template text NOT NULL,
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- One email per template per order — enforced by the database, not application logic.
CREATE UNIQUE INDEX IF NOT EXISTS email_sent_log_order_template_uniq
  ON email_sent_log (order_id, template)
  WHERE order_id IS NOT NULL;

ALTER TABLE email_sent_log ENABLE ROW LEVEL SECURITY;
