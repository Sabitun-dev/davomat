# Davomat

Telegram Mini App for staff attendance, lateness and daily pay.

The full setup guide is written at the end of the build (phase 8). Short version:

- `npm install` – installs everything and prepares the database client.
- `npm test` – runs all tests (they use an in-memory database, no setup needed).
- `npm run build` – builds the Mini App into `public/app/`.
- Netlify runs `npm run netlify-build` on every push.
