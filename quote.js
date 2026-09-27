export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    const contentType = request.headers.get("content-type") || "";
    let data = {};

    if (contentType.includes("application/json")) {
      data = await request.json();
    } else {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        data[key] = typeof value === "string" ? value : "";
      }
    }

    const token =
      data["cf-turnstile-response"] ||
      data["turnstileToken"] ||
      data["turnstile-token"];

    if (!token) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Turnstile token is missing."
      }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";

    const verifyResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: ip
        })
      }
    );

    const result = await verifyResponse.json();

    if (!result.success) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Turnstile verification failed."
      }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    }

    // Turnstile is verified successfully.
    // Put your email-delivery provider/API call here if you want
    // the submission forwarded to your email.
    return new Response(JSON.stringify({
      ok: true,
      message: "Form verified successfully."
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Server error."
    }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}
