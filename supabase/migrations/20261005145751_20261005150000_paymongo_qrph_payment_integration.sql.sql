-- Add QR Ph-specific columns to payment_transactions for storing
-- the dynamic QR image URL and payment expiry timestamp.
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS qr_image_url text;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Add provider_payment_id column to store the PayMongo payment ID
-- (distinct from provider_reference which stores the payment intent ID).
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider_payment_id text;

-- Add webhook_event_id column for idempotent webhook processing.
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS webhook_event_id text;

-- Insert the QR Ph payment config row if it doesn't already exist.
-- This is the automated PayMongo QR Ph payment method.
INSERT INTO payment_config (
  method_key, display_name, provider, provider_type, provider_name,
  is_enabled, api_url, is_test_mode, currency, supported_methods,
  sort_order, instructions, notes, webhook_url
)
SELECT
  'paymongo_qrph', 'QR Ph', 'Paymongo', 'automated', 'paymongo',
  false, '', false, 'PHP', ARRAY['qrph'],
  10, 'Scan the QR code using your banking or e-wallet app to pay instantly.', 'Automated QR Ph via PayMongo. Requires PAYMENT_PAYMONGO_SECRET_KEY env var.', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM payment_config WHERE method_key = 'paymongo_qrph'
);
