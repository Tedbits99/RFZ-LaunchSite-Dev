import { createClient } from "npm:@supabase/supabase-js@2";

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
    template: "payment_success" | "fulfillment_failed",
    to: string (customer email),
    order_reference: string,
    customer_name: string,
    package_name: string,
    total_php: string,
    error_detail?: string (for fulfillment_failed only)
  }
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface EmailRequest {
  order_id: string;
  template: "payment_success" | "fulfillment_failed";
  to: string;
  order_reference: string;
  customer_name: string;
  package_name: string;
  total_php: string;
  error_detail?: string;
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

async function sendSmtp(
  smtpHost: string,
  smtpPort: number,
  smtpUser: string,
  smtpPass: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  const dateHeader = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@runfazone.com>`;
  const boundary = "----=_Part_" + Math.random().toString(36).slice(2);

  const mime = [
    `From: RunFazone <${from}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Date: ${dateHeader}`,
    `Message-ID: ${messageId}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
    ``,
  ].join("\r\n");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const msgBytes = encoder.encode(mime);

  let tlsConn: Deno.TlsConn;
  try {
    const conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `TLS connection to ${smtpHost}:${smtpPort} failed: ${msg}` };
  }

  try {
    const reader = tlsConn.readable.getReader();
    const writer = tlsConn.writable.getWriter();

    async function readResponse(): Promise<string> {
      const chunks: string[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
        const text = chunks.join("");
        const lines = text.split("\r\n");
        const last = lines[lines.length - 1];
        if (last.length >= 4 && last[3] === " ") return text;
        if (last.length === 0 && lines.length > 1) return text;
      }
      return chunks.join("");
    }

    async function sendCommand(cmd: string): Promise<string> {
      await writer.write(encoder.encode(cmd + "\r\n"));
      return readResponse();
    }

    // 1. Read server greeting
    await readResponse();

    // 2. EHLO
    await sendCommand("EHLO runfazone.com");

    // 3. AUTH LOGIN
    await sendCommand("AUTH LOGIN");
    await sendCommand(btoa(smtpUser));
    const authResult = await sendCommand(btoa(smtpPass));
    if (!authResult.startsWith("235")) {
      return { success: false, error: `SMTP auth failed: ${authResult.trim()}` };
    }

    // 4. MAIL FROM
    const mailFrom = await sendCommand(`MAIL FROM:<${from}>`);
    if (!mailFrom.startsWith("250")) {
      return { success: false, error: `MAIL FROM rejected: ${mailFrom.trim()}` };
    }

    // 5. RCPT TO
    const rcptTo = await sendCommand(`RCPT TO:<${to}>`);
    if (!rcptTo.startsWith("250")) {
      return { success: false, error: `RCPT TO rejected: ${rcptTo.trim()}` };
    }

    // 6. DATA
    const dataResp = await sendCommand("DATA");
    if (!dataResp.startsWith("354")) {
      return { success: false, error: `DATA not accepted: ${dataResp.trim()}` };
    }
    await writer.write(msgBytes);
    const dataEnd = await sendCommand("\r\n.");

    if (!dataEnd.startsWith("250")) {
      return { success: false, error: `SMTP data rejected: ${dataEnd.trim()}` };
    }

    // 7. QUIT
    await sendCommand("QUIT");

    reader.releaseLock();
    writer.releaseLock();
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `SMTP communication error: ${msg}` };
  } finally {
    try { tlsConn.close(); } catch { /* ignore */ }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
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
    if (!SMTP_USER || !SMTP_PASSWORD) {
      return json({ error: "SMTP credentials not configured" }, 503);
    }

    const body = await req.json() as EmailRequest;

    if (!body.order_id || !body.template || !body.to) {
      return json({ error: "Missing required fields: order_id, template, to" }, 400);
    }

    if (body.template !== "payment_success" && body.template !== "fulfillment_failed") {
      return json({ error: "Unknown template: " + body.template }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Duplicate prevention: insert into email_sent_log.
    // Unique constraint on (order_id, template) means a second insert for the
    // same order+template fails — the email was already sent.
    const { error: logError } = await supabase.from("email_sent_log").insert({
      order_id: body.order_id,
      template: body.template,
      recipient: body.to,
    });

    if (logError) {
      const msg = String(logError.message || "");
      if (msg.includes("duplicate key") || msg.includes("unique") || msg.includes("violates")) {
        return json({ received: true, message: "Email already sent for this order and template" });
      }
      console.error("email_sent_log insert error:", msg);
    }

    const from = SMTP_USER.includes("@") ? SMTP_USER : "orders@runfazone.com";
    const subject = body.template === "payment_success"
      ? `Payment Confirmed — Order ${body.order_reference}`
      : `Fulfillment Update — Order ${body.order_reference}`;

    const html = body.template === "payment_success"
      ? buildPaymentSuccessHtml(body)
      : buildFulfillmentFailedHtml(body);
    const text = body.template === "payment_success"
      ? buildPaymentSuccessText(body)
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
      return json({ error: "Failed to send email", detail: result.error }, 500);
    }

    return json({ success: true, template: body.template, recipient: body.to });
  } catch (err) {
    console.error("send-transactional-email error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: "Email service error", detail: msg }, 500);
  }
});