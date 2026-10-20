# Major data flows

## Customer top-up

```text
homepage -> game/[slug] -> select package/player/payment
         -> optional verify-player Edge Function
         -> POST /api/vouchers/validate (preview)
         -> POST /api/orders -> create_order RPC
         -> WAITING_PAYMENT order + timeline
         -> manual proof OR QR/payment provider
         -> payment submission / webhook verification
         -> payment_status VERIFIED, status PAYMENT_VERIFIED
         -> startFulfillment / webhook trigger
         -> supplier transaction + fulfillment PROCESSING
         -> supplier poll/reconciliation
         -> fulfillment COMPLETED or FAILED + timeline
         -> tracking page polling/Realtime + email
```

## Manual payment

The customer submits payment reference/proof through `submit_payment`, which matches order reference/email, inserts a submission, stores payment reference/submission time, and adds a timeline entry. Admin then calls `verify_payment`; this does not itself start fulfillment in the admin endpoint, so fulfillment is a separate controlled action.

## QR payment

The checkout client calls the Next QR bridge, which invokes the QR Edge Function. The function checks order state, reuses an active transaction where possible, calls PayMongo, stores QR/provider/expiry details, and the client polls/status-subscribes. The webhook path validates a signed event, checks amount/order mapping, makes payment verification idempotent, and can trigger fulfillment.

## Fulfillment

`startFulfillment` checks verified payment and nonterminal state, atomically claims `NOT_STARTED → PROCESSING`, resolves the captured or eligible supplier mapping, writes an idempotent transaction, calls the adapter, and records the result. Immediate polling uses short backoff; the auto-reconciliation Edge Function is the longer-running fallback.

## Customer status

Tracking endpoints require reference/email and return order-safe fields plus timeline. Account order detail uses status polling and Supabase Realtime for order/timeline updates. Terminal state stops polling.

## Email

Payment success and fulfillment failure calls are fire-and-forget from server code. The email Edge Function enforces one template/order through `email_sent_log` and sends using SMTP secrets.
