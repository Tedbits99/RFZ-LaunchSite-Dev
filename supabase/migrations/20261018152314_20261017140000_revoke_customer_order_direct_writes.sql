-- Customer sessions must use the protected order/payment RPC boundaries.
-- These are the two confirmed effective table privileges left by the
-- customer/order lockdown migration; do not revoke the create_order or
-- server-side payment/fulfillment function grants here.

REVOKE UPDATE ON TABLE public.orders FROM authenticated;
REVOKE INSERT ON TABLE public.order_timeline FROM authenticated;
