FUNCLEAN — Cloudflare Pages + Turnstile

Correct deployment for Cloudflare Pages:
- Build command: leave EMPTY
- Build output directory: .
- Do NOT use: npx wrangler deploy
- If using Wrangler manually:
  npx wrangler pages deploy . --project-name YOUR_PROJECT_NAME

Project structure:
  index.html
  wrangler.jsonc
  functions/
    api/
      quote.js

Turnstile:
- Site key is already in index.html.
- Add TURNSTILE_SECRET_KEY as a Cloudflare Pages Environment Variable/Secret.
- Never put the secret key in HTML.
- Production and Preview environments can be configured separately.

Important:
The Pages Function validates Turnstile server-side. Email delivery is intentionally
not invented here because an email provider/API and destination are not specified.
