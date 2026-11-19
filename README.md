# Davomat

A Telegram Mini App for staff attendance, lateness and daily pay.

Workers keep sending their round video to the group, exactly as before. After the video they open the
app, tap the one button that fits right now (Keldim / Tanaffus / Tanaffusdan qaytdim / Ketdim), scan
the branch QR code, and the server checks that their phone is inside the branch area. Lateness,
statistics and pay are calculated automatically.

---

## 1. One-time setup (about 30 minutes)

You need: a Telegram account, a free [Neon](https://neon.tech) account, a [Netlify](https://netlify.com)
account connected to this GitHub repo.

### Step 1 — Create the bot (BotFather)

1. In Telegram open **@BotFather** and send `/newbot`. Choose a name (e.g. *Davomat*) and a username
   ending in `bot` (e.g. `sobitxon_davomat_bot`).
2. BotFather gives you a **token** like `123456:ABC...`. This is `BOT_TOKEN`. Keep it secret.
3. Send `/setprivacy` → choose your bot → **Disable**. (The bot must see round videos in the group.)
   Alternatively make the bot an admin of the group later; either works.
4. The Mini App link (`t.me/<bot>/<app>`) is made in Step 4, after the site has an address.

### Step 2 — Create the database (Neon)

1. In Neon create a project. Pick the region closest to your Netlify site (e.g. *Frankfurt*).
2. On the project dashboard press **Connect**. Copy two strings:
   - **Pooled connection** (the host name contains `-pooler`) → `DATABASE_URL`
   - **Direct connection** (untick "Connection pooling") → `DATABASE_URL_UNPOOLED`

### Step 3 — Netlify

1. In Netlify: **Add new site → Import an existing project → GitHub → `davomat`**.
   The project is at the repo root, so **Base directory stays empty**. The build command and publish folder
   come from `netlify.toml` automatically.
2. **Site configuration → Environment variables → Add variables**. Add each of these (scope: *All*, so
   both the build and the functions can read them):

   | Name | What to put |
   |---|---|
   | `BOT_TOKEN` | the token from BotFather |
   | `WEBHOOK_SECRET` | a random string, 32+ characters |
   | `SETUP_SECRET` | another random string, 32+ characters |
   | `QR_SIGNING_SECRET` | another random string, 32+ characters. **Changing it later breaks all printed QR codes.** |
   | `DATABASE_URL` | Neon pooled connection string |
   | `DATABASE_URL_UNPOOLED` | Neon direct connection string |
   | `OWNER_TELEGRAM_IDS` | your Telegram user id (ask **@userinfobot**). Several owners: `111,222` |
   | `GROUP_CHAT_ID` | leave empty for now (Step 5) |
   | `MINIAPP_SHORT_NAME` | `app` (the short name you will give in Step 4) |
   | `DEFAULT_LANGUAGE` | `uz` |
   | `DEFAULT_TIMEZONE` | `Asia/Tashkent` |
   | `BOT_USERNAME` | optional, filled automatically by the setup page |

   To make a random string, open any terminal and run:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   (or use a password generator, 40 letters and digits).
3. **Deploys → Trigger deploy**. The build runs type checks, all tests, builds the app and applies the
   database migrations. If anything fails, Netlify keeps the previous version online.
4. Note your site address, e.g. `https://davomat-xyz.netlify.app`.

### Step 4 — Register the Mini App

1. In **@BotFather** send `/newapp` → choose your bot.
2. Title *Davomat*, a short description, a 640×360 picture (any), skip the GIF.
3. Web App URL: `https://<your-site>/app/`
4. Short name: `app` (must match `MINIAPP_SHORT_NAME`).
   Invite links will look like `https://t.me/<bot>/app?startapp=inv_...`.

### Step 5 — Run the setup page

Open in a browser: `https://<your-site>/setup?key=<SETUP_SECRET>`

It checks the settings and the database, connects the bot to Telegram (webhook with a secret), sets
the bot commands and the **"Ochish"** menu button. Every line should be ✅. Opening it again is always safe.

### Step 6 — Connect the group

1. Add the bot to your bosses-and-workers group (it should be a **supergroup**; Telegram turns a group
   into one automatically when you change certain settings, e.g. "Chat history for new members: Visible").
2. If you did not disable privacy in Step 1, make the bot a group admin.
3. In the group send `/groupid`. The bot answers with a number like `-1001234567890`.
4. Put it into Netlify as `GROUP_CHAT_ID`, then **Trigger deploy** again, then open the setup page again.
   The "Group" line must be ✅.

### Step 7 — First use

1. In the bot chat tap **Ochish**. You (the owner) go through: consent → share phone → confirm name.
2. **Filiallar → Yangi filial**: name, address, put the pin on the map (or "Mening joylashuvim" while
   standing in the branch), radius 25 m. Save.
3. On the **QR** tab tap **"A4 plakatni chatga yuborish"**. The bot sends you a PDF poster. Print it and
   put it up at the entrance.
4. On the **Jadval** button set working hours; on **Summalar** set daily amounts (or set a default amount
   per worker).
5. On the **Taklif** tab create an invite link and share it with the workers.

---

## 2. Test on two phones (checklist)

Phone A = you (owner). Phone B = a worker. Stand inside the branch with the printed poster.

- [ ] A: create a branch, get the QR **PNG** and the **A4 poster** in the bot chat.
- [ ] A: create a single-use invite and send it to B.
- [ ] B: open the link → consent → share phone → name → **Qo'shilish**. A sees B in *Xodimlar*.
- [ ] B: send a round video to the group, then **Keldim** → scan the poster → success screen with time,
      distance (e.g. "12 m") and "on time" or "7 min late".
- [ ] B: **Tanaffus** → scan → **Tanaffusdan qaytdim** → scan → **Ketdim** → confirm → scan.
- [ ] B: walk 100 m away and try → "Siz 100 m uzoqdasiz, ruxsat 25 m…".
- [ ] B: turn location off and try → the guided screen with iPhone/Android pictures.
- [ ] B: scan any other QR code → "Bu filial QR kodi emas".
- [ ] B: tap twice fast → only one event is saved.
- [ ] A: **Bugun** shows B as working / on break; the day drawer shows the four times, distances and
      **Videoni ochish**.
- [ ] A: set B's daily amount to 100 USD (or so'm), hours 09:00–19:00. Correct B's check-in to 09:30 and
      check-out to 18:30 (comment required) → day shows **90.00** (spec example A). Export
      **Hisobot → XLSX** → the file in the bot chat shows 90 too.
- [ ] A: **Hisobot → Oyni yopish**, then try to change something → "Bu oy yopilgan". Only the owner can
      unlock (with a comment).
- [ ] Next morning: absences, auto-closed days and "video without scan" appear in **Tekshirish kerak**.

---

## 3. How the app works (plain words)

### Pay (spec 6.3)
Per worker per day, in whole minutes (seconds are ignored):

```
scheduled = end - start
late      = 0 if arrived by start + grace, else minutes after start (or after grace, by setting)
early     = minutes left before end
overage   = break minutes over the daily allowance (breaks only count inside working hours)
worked    = scheduled - late - early - overage   (never below 0, never above scheduled)
earned    = daily amount × worked / scheduled    (rounded half up to 1 so'm / 1 cent)
```
Arriving early or staying late adds nothing (overtime is off). No check-in on a working day = absent.
No check-out = the day closes itself at the scheduled end 2 hours later and is marked *needs review*.
Final salary = sum of earned + bonuses − fines. All spec examples A–I are automatic tests.

The daily amount for a day is the number in the **Summalar** grid, or, if that cell is empty, the
worker's default amount. A day off with a check-in is an "extra day", paid only if you put an amount in
that day's cell.

### Anti-cheating — the honest trade-off
- A printed QR can be photographed and sent to a friend. **The GPS check is the real protection**: the
  server measures the distance itself and the phone must be inside the radius with good accuracy.
- **Rotating QR** (branch setting) makes it much stronger: a tablet at the branch shows a code that
  changes every 30 seconds. Open the tablet link from *QR → Planshet ekranlari*.
- A web app **cannot detect fake-GPS apps**. That is why the app flags suspicious patterns for you
  (never blocks): GPS accuracy exactly 0, the same coordinates twice, an impossible jump between
  branches, two workers from one phone on the same day, success right at the edge after several "too
  far" fails, and a scan without a group video. Check them in **Tekshirish kerak**.
- Every attempt, accepted or rejected, is stored with time, location, accuracy, distance and device.
- Raw GPS is deleted after 12 months (setting); the results stay.

### Security
- Identity comes only from Telegram: every request is checked with Telegram's signature (HMAC-SHA256,
  max 24 h old). There are no passwords.
- The phone number is accepted only from the contact message the **bot** receives, and only if it is
  the sender's own number.
- Secrets live only in Netlify environment variables, never in the code or the app. Logs remove them.

### Bot messages (light, never spam)
Workers: "you haven't checked in yet" 10 min after start; "forgot to check out?" 30 min after end.
Admins: a morning summary, a daily flag summary, and "payroll is ready" on the 1st. Every message is
sent at most once per kind per person per day. Change or switch them off in **Yana → Kompaniya sozlamalari**.

### Settings (Yana → Kompaniya sozlamalari, owner only)
GPS accuracy limit (50 m), extra metres beyond radius (0), earliest check-in (3 h before start),
auto-close (2 h after end), video window (15 min before / 5 min after), bot reply under the video (off),
missing-video flag (on), reminders, summaries, invite expiry (7 days), GPS retention (12 months),
attempts per 5 minutes (10). Per branch: radius, grace and grace mode, break allowance, QR type.

---

## 4. For developers

```
npm install          # also prepares the database client
npm test             # 112 tests; they use an in-memory Postgres (PGlite), no setup needed
npm run typecheck
npm run build        # builds the Mini App into public/app/
npm run screenshots  # design review: every screen, light/dark, 360/414 px -> screenshots/
npm run db:seed      # demo data (needs DATABASE_URL in .env); refuses a non-empty database
```

Layout:
- `src/` — all business logic in plain TypeScript (pay engine, state machine, geofence, QR tokens,
  schedules, reports, exports, bot, scheduler). Netlify-specific code is only in `netlify/functions/`,
  so moving to Railway or a VPS means writing one small server file.
- `netlify/functions/` — `api.mts` (`/api/*`), `telegram.mts` (webhook), `scheduler.mts` (every 15 min),
  `setup.mts` (`/setup`).
- `webapp/` — React + Vite + Tailwind Mini App. `src/shared/` is used by both sides.
- `prisma/` — schema, migrations (applied by the Netlify build), demo seed.

Database changes: edit `prisma/schema.prisma`, then create a **new** migration with
`npx prisma migrate dev --name <what-changed>` against a Neon *development branch* (put its URLs in `.env`).
Never edit a migration that is already applied.

---

## 5. What is not built yet / known limits

- **Night shifts** across midnight are not supported (a check-out after midnight is refused; the day
  auto-closes). The data model allows adding them later.
- **Overtime pay** is a setting only; it is not calculated.
- **Offline check-ins** are not possible by design (the server's time is the truth).
- Schedule templates are not versioned: changing the weekly schedule recalculates the current month;
  past open months keep their numbers until someone presses *Oyni qayta hisoblash*. Lock months after
  payroll to be safe.
- Changing the company currency does not convert stored amounts.
- I could not test inside real Telegram or on real phones from here; that is what the checklist above is for.

## 6. Ideas for later

Tasks, in-app chat, subscriptions (out of scope for v1, as agreed); night shifts; overtime pay; per-worker
salary types; leave/vacation requests; push of the monthly payslip to each worker; Telegram Stars or
Click/Payme payouts; a public holiday calendar for Uzbekistan; face check on the round video; multi-company
mode (every table already has `company_id`); a web dashboard for big screens.
