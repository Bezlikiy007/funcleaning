// Fun Cleaning — quote form backend
// - Verifies the Turnstile token via canonical siteverify (server-side, never trust the client)
// - Rejects the honeypot field, oversized photos, and stale/forged submissions
// - Emails the request via Cloudflare Email Routing (SEND_EMAIL binding)
//
// Required setup (see SETUP.md):
//   wrangler secret put TURNSTILE_SECRET
//   send_email binding "SEND_EMAIL" configured in wrangler.toml
//   destination address funcleaningyeg@gmail.com verified in Email Routing

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

const EXPECTED_ACTION = "quote_request";
const EXPECTED_HOSTNAMES = new Set(["funcleaningyeg.ca", "www.funcleaningyeg.ca"]);
const ALLOWED_ORIGINS = new Set([
  "https://funcleaningyeg.ca",
  "https://www.funcleaningyeg.ca",
]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // keep email attachments sane

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      // Native <form> fallback (no JS) sends no Origin header on same-site nav in some
      // browsers; allow that case through but never relax this for a cross-origin fetch.
      if (origin !== "") {
        return new Response("forbidden", { status: 403 });
      }
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    // Honeypot: real users never fill this in.
    if ((form.get("bot-field") || "").toString().trim() !== "") {
      // Pretend success so bots don't learn anything; drop silently.
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const token = form.get("cf-turnstile-response");
    if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
      return new Response("forbidden", { status: 403 });
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "";

    let verify;
    try {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: clientIp,
        }),
      });
      if (!r.ok) throw new Error(`siteverify ${r.status}`);
      verify = await r.json();
    } catch {
      return new Response("forbidden", { status: 403 });
    }

    if (
      !verify.success ||
      verify.action !== EXPECTED_ACTION ||
      !EXPECTED_HOSTNAMES.has(verify.hostname)
    ) {
      return new Response("forbidden", { status: 403 });
    }

    // --- existing "handler" logic starts here: build and send the notification ---
    const field = (name) => (form.get(name) || "").toString().trim();

    const lines = [
      `Service: ${field("service")}`,
      `Frequency: ${field("frequency")}`,
      `Location: ${field("location")}`,
      `Name: ${field("name")}`,
      `Phone: ${field("phone")}`,
      `Email: ${field("email") || "(not provided)"}`,
      `Reply via: ${field("reply_via")}`,
      `Referrer: ${field("referrer") || "(direct)"}`,
      `Landing page: ${field("landing_page")}`,
      `UTM source: ${field("utm_source") || "-"}`,
    ];

    const msg = createMimeMessage();
    msg.setSender({ name: "Fun Cleaning Website", addr: "quotes@funcleaningyeg.ca" });
    msg.setRecipient("funcleaningyeg@gmail.com");
    msg.setSubject(`New quote request — ${field("service") || "unspecified service"}`);
    msg.addMessage({ contentType: "text/plain", data: lines.join("\n") });

    const photo = form.get("photo");
    if (photo && typeof photo === "object" && "arrayBuffer" in photo && photo.size > 0) {
      if (photo.size <= MAX_PHOTO_BYTES) {
        const buf = await photo.arrayBuffer();
        msg.addAttachment({
          filename: photo.name || "photo.jpg",
          contentType: photo.type || "image/jpeg",
          data: btoa(String.fromCharCode(...new Uint8Array(buf))),
        });
      } else {
        msg.addMessage({ contentType: "text/plain", data: "\n[Photo omitted: file too large to attach]" });
      }
    }

    try {
      const email = new EmailMessage("quotes@funcleaningyeg.ca", "funcleaningyeg@gmail.com", msg.asRaw());
      await env.SEND_EMAIL.send(email);
    } catch (err) {
      return new Response("could not send notification", { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};
