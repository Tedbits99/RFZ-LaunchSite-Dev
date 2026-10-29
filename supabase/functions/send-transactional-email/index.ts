import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@10.2.0";
import { hasAuthorizedTransactionalEmailRequest } from "../_shared/transactionalEmailAuth.ts";

/*
  Shared transactional email sender for RunFazone.

  Called by:
  - payment-webhook Edge Function (after verify_payment succeeds)
  - admin verify-payment Next.js route (after manual verification)
  - payment-webhook polling / admin retry (on fulfillment failure)

  Uses Titan Business Email SMTP (smtp.titan.email:465, SSL/TLS).
  SMTP credentials are stored as Edge Function secrets:
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD

  Duplicate prevention: each (order_id, template) pair is inserted into
  email_sent_log with a unique constraint. If a row already exists, the
  email is not re-sent.

  POST /functions/v1/send-transactional-email
  Body: {
    order_id: string,
    template: "payment_success" | "fulfillment_failed" | "guest_order_access",
    to: string (customer email),
    order_reference: string,
    customer_name: string,
    package_name: string,
    total_php: string,
  error_detail?: string (for fulfillment_failed only)
  access_code?: string (for guest_order_access only)
  }
*/

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

interface EmailRequest {
  order_id: string;
  template: "payment_success" | "fulfillment_failed" | "guest_order_access";
  to: string;
  order_reference: string;
  customer_name: string;
  package_name: string;
  total_php: string;
  error_detail?: string;
  access_code?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPaymentSuccessHtml(r: EmailRequest): string {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
  <div style="background:#0a1124;border-radius:12px;padding:24px 28px">
    <h1 style="color:#22d3ee;font-size:22px;margin:0 0 16px">Payment Confirmed</h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6">Hi ${escapeHtml(r.customer_name)},</p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6">We've received your payment for the following order:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#94a3b8;font-size:13px">Order Reference</td><td style="padding:8px 0;color:#e2e8f0;font-size:14px;font-weight:600">${escapeHtml(r.order_reference)}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8;font-size:13px">Package</td><td style="padding:8px 0;color:#e2e8f0;font-size:14px">${escapeHtml(r.package_name)}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8;font-size:13px">Amount Paid</td><td style="padding:8px 0;color:#22d3ee;font-size:14px;font-weight:600">${escapeHtml(r.total_php)}</td></tr>
    </table>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6">Your top-up is now being processed. We'll notify you once it's completed.</p>
    <div style="margin-top:24px;border-top:1px solid #1b2a45;padding-top:16px">
      <p style="color:#e2e8f0;font-size:15px;font-weight:700;margin:0 0 4px">RunFazone</p>
      <p style="color:#94a3b8;font-size:12px;margin:0 0 12px">Game Top-Up Made Easy</p>
      <p style="color:#cbd5e1;font-size:13px;margin:0 0 8px">RunFazone Support Team</p>
      <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0">Need help with your order? Reply to this email or contact <a href="mailto:orders@runfazone.com" style="color:#22d3ee;text-decoration:none">orders@runfazone.com</a>.</p>
    </div>
  </div>
</body></html>`;
}

function buildFulfillmentFailedHtml(r: EmailRequest): string {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
  <div style="background:#0a1124;border-radius:12px;padding:24px 28px">
    <h1 style="color:#f87171;font-size:22px;margin:0 0 16px">Fulfillment Issue</h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6">Hi ${escapeHtml(r.customer_name)},</p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6">Your payment was received but we encountered an issue while processing your top-up. Our team has been notified and is working to resolve it.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#94a3b8;font-size:13px">Order Reference</td><td style="padding:8px 0;color:#e2e8f0;font-size:14px;font-weight:600">${escapeHtml(r.order_reference)}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8;font-size:13px">Package</td><td style="padding:8px 0;color:#e2e8f0;font-size:14px">${escapeHtml(r.package_name)}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8;font-size:13px">Amount Paid</td><td style="padding:8px 0;color:#e2e8f0;font-size:14px">${escapeHtml(r.total_php)}</td></tr>
    </table>
    <p style="color:#94a3b8;font-size:13px;line-height:1.6">If you have questions, reply to this email or contact our support team with your order reference.</p>
    <div style="margin-top:24px;border-top:1px solid #1b2a45;padding-top:16px">
      <p style="color:#e2e8f0;font-size:15px;font-weight:700;margin:0 0 4px">RunFazone</p>
      <p style="color:#94a3b8;font-size:12px;margin:0 0 12px">Game Top-Up Made Easy</p>
      <p style="color:#cbd5e1;font-size:13px;margin:0 0 8px">RunFazone Support Team</p>
      <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0">Need help with your order? Reply to this email or contact <a href="mailto:orders@runfazone.com" style="color:#22d3ee;text-decoration:none">orders@runfazone.com</a>.</p>
    </div>
  </div>
</body></html>`;
}

function buildPaymentSuccessText(r: EmailRequest): string {
  return `Payment Confirmed — RunFazone

Hi ${r.customer_name},

We've received your payment for the following order:

Order Reference: ${r.order_reference}
Package: ${r.package_name}
Amount Paid: ${r.total_php}

Your top-up is now being processed. We'll notify you once it's completed.

RunFazone
Game Top-Up Made Easy

RunFazone Support Team
Need help with your order? Reply to this email or contact orders@runfazone.com.`;
}

function buildFulfillmentFailedText(r: EmailRequest): string {
  return `Fulfillment Issue — RunFazone

Hi ${r.customer_name},

Your payment was received but we encountered an issue while processing your top-up. Our team has been notified and is working to resolve it.

Order Reference: ${r.order_reference}
Package: ${r.package_name}
Amount Paid: ${r.total_php}

If you have questions, reply to this email or contact our support team with your order reference.

RunFazone
Game Top-Up Made Easy

RunFazone Support Team
Need help with your order? Reply to this email or contact orders@runfazone.com.`;
}

function buildGuestAccessHtml(r: EmailRequest): string {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
  <div style="background:#0a1124;border-radius:12px;padding:24px 28px">
    <h1 style="color:#22d3ee;font-size:22px">Verify guest order access</h1>
    <p style="color:#cbd5e1">Use this one-time code to access order ${escapeHtml(r.order_reference)}:</p>
    <p style="font-family:monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:#22d3ee">${escapeHtml(r.access_code || '')}</p>
    <p style="color:#94a3b8">The code expires in 15 minutes and can be used once. If you did not request it, you can ignore this email.</p>
    <p style="color:#94a3b8">RunFazone Support Team</p>
  </div></body></html>`;
}

function buildGuestAccessText(r: EmailRequest): string {
  return `Verify guest order access\n\nUse this one-time code to access order ${r.order_reference}:\n\n${r.access_code || ''}\n\nThe code expires in 15 minutes and can be used once. If you did not request it, ignore this email.`;
}

/**
 * Titan SMTP implicit TLS on port 465 (587 is blocked by Supabase Edge).
 * Nodemailer handles the SMTP protocol, international text and MIME safely.
 */
async function sendSmtp(
  smtpHost: string, smtpPort: number, smtpUser: string, smtpPass: string,
  from: string, to: string, subject: string, html: string, text: string,
): Promise<{ success: boolean; error?: string }> {
  if (smtpPort !== 465 || !smtpHost || !smtpUser || !smtpPass) {
    return { success: false, error: "invalid_smtp_configuration" };
  }
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: 465,
    secure: true,
    requireTLS: true,
    tls: { minVersion: "TLSv1.2", servername: smtpHost },
    auth: { user: smtpUser, pass: smtpPass },
    pool: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const info = await transport.sendMail({
      from: { name: "RunFazone", address: from },
      to, subject, html, text,
      envelope: { from, to },
    });
    const accepted = (info.accepted ?? []).map((address: string) => address.toLowerCase());
    if ((info.rejected?.length ?? 0) > 0 || !accepted.includes(to.toLowerCase())) {
      return { success: false, error: "recipient_rejected" };
    }
    return { success: true };
  } catch (error) {
    // Never return Titan's raw SMTP reply; it can contain private data.
    const code = (error as { code?: string })?.code;
    return { success: false, error:
      code === "EAUTH" ? "smtp_authentication_failed"
      : code === "ETIMEDOUT" || code === "ESOCKET" ? "smtp_connection_failed"
      : "smtp_delivery_failed" };
  } finally {
    transport.close();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.titan.email";
    const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465", 10);
    const SMTP_USER = Deno.env.get("SMTP_USER") || "";
    const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") || "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Service unavailable" }, 503);
    }
    if (!hasAuthorizedTransactionalEmailRequest(req, SERVICE_KEY)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (!SMTP_USER || !SMTP_PASSWORD || SMTP_USER.trim().toLowerCase() !== "orders@runfazone.com" || SMTP_PORT !== 465) {
      return json({ error: "Titan SMTP settings missing or invalid" }, 503);
    }

    const body = await req.json() as EmailRequest;

    if (!body.order_id || !body.template || !body.to) {
      return json({ error: "Missing required fields: order_id, template, to" }, 400);
    }

    if (body.template !== "payment_success" && body.template !== "fulfillment_failed" && body.template !== "guest_order_access") {
      return json({ error: "Unknown template: " + body.template }, 400);
    }

    if (body.template === "guest_order_access"
      && (!body.access_code || !body.order_reference || !body.to)) {
      return json({ error: "Missing guest-access email fields" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Duplicate prevention: insert into email_sent_log.
    // Unique constraint on (order_id, template) means a second insert for the
    // same order+template fails — the email was already sent.
    const { error: logError } = body.template === "guest_order_access"
      ? { error: null }
      : await supabase.from("email_sent_log").insert({
        order_id: body.order_id,
        template: body.template,
        recipient: body.to,
      });

    if (logError) {
      const msg = String(logError.message || "");
      if (msg.includes("duplicate key") || msg.includes("unique") || msg.includes("violates")) {
        return json({ received: true, message: "Email already sent for this order and template" }, 200);
      }
      console.error("email_sent_log insert failed");
      return json({ error: "Email delivery tracking unavailable" }, 503);
    }

    const from = "orders@runfazone.com";
    const subject = body.template === "payment_success"
      ? `Payment Confirmed — Order ${body.order_reference}`
      : body.template === "guest_order_access"
        ? `Guest Order Access Code — ${body.order_reference}`
        : `Fulfillment Update — Order ${body.order_reference}`;

    const html = body.template === "payment_success"
      ? buildPaymentSuccessHtml(body)
      : body.template === "guest_order_access"
        ? buildGuestAccessHtml(body)
        : buildFulfillmentFailedHtml(body);
    const text = body.template === "payment_success"
      ? buildPaymentSuccessText(body)
      : body.template === "guest_order_access"
        ? buildGuestAccessText(body)
        : buildFulfillmentFailedText(body);

    const result = await sendSmtp(
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
      from, body.to, subject, html, text,
    );

    if (!result.success) {
      // Remove the log entry so a retry can re-send
      await supabase.from("email_sent_log")
        .delete()
        .eq("order_id", body.order_id)
        .eq("template", body.template);

      console.error("SMTP send failed:", result.error);
      return json({ error: "Failed to send email", reason: result.error }, 502);
    }

    return json({ success: true, template: body.template, recipient: body.to }, 200);
  } catch (err) {
    console.error("send-transactional-email failed");
    return json({ error: "Email service error" }, 500);
  }
});
