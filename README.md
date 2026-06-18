# יומן קטו — KetoLog

A keto diary (Hebrew, RTL) built as a **MERN** app: **M**ongoDB · **E**xpress · **R**eact (Vite + SCSS) · **N**ode.
Log meals, auto-estimate net carbs / fat / protein from a free-text description or a product photo
(via the Claude API), keep a personal product list, and track daily metrics — all per user account,
saved in the cloud.

```
ketolog/
├── server/   Express API + MongoDB (Mongoose) + Claude proxy   →  http://localhost:4000
└── client/   React + Vite + SCSS UI                            →  http://localhost:5173
```

The browser only ever talks to the Express server. **Your Anthropic key and Mongo string live on the
server (`server/.env`) and are never sent to the browser or committed to git.**

---

## What you need (one-time)

1. **MongoDB Atlas** (free): a cluster + a database user + a connection string.
   - Atlas → *Database → Connect → Drivers* → copy the `mongodb+srv://…` string.
   - Atlas → *Network Access* → Add IP → `0.0.0.0/0` (allow from anywhere) for local dev.
2. **Anthropic API key**: console.anthropic.com → *API Keys* → create one (`sk-ant-…`), and add ~$5 credit under *Billing*.
3. **Node 18+** (you have v24) and **git**.

---

## Setup

```bash
# 1. Backend env
cd server
cp .env.example .env
#   then edit .env and fill in MONGODB_URI, ANTHROPIC_API_KEY, JWT_SECRET
#   generate a JWT secret with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 2. Install dependencies (run in each folder)
cd ../server && npm install
cd ../client && npm install
```

## Run (two terminals)

```bash
# terminal 1 — API
cd server && npm run dev      # http://localhost:4000

# terminal 2 — web app
cd client && npm run dev      # http://localhost:5173  (open this)
```

Open **http://localhost:5173**, create an account, and start logging. The Vite dev server proxies all
`/api/*` calls to the Express server, so there are no CORS issues.

> The app runs even without `ANTHROPIC_API_KEY` — everything works except the AI estimate buttons,
> which return a clear "AI not configured" message. Add the key to enable them.

---

## API overview

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | create account / sign in (returns a JWT) |
| GET | `/api/auth/me` | current user |
| GET | `/api/days` | all days for the logged-in user |
| PUT | `/api/days/:date` | upsert a day (label / metrics) |
| PATCH | `/api/days/:date/metrics` | set one metric (weight/run/abs/status) |
| POST · DELETE | `/api/days/:date/meals` · `/api/days/:date/meals/:id` | add / remove a meal |
| GET · POST · DELETE | `/api/products` … | manage saved products |
| POST | `/api/ai/estimate-meal` | net carbs + macros from a text description |
| POST | `/api/ai/estimate-image` | read a product label / package photo |

All routes except `/api/auth/*` and `/api/health` require a `Bearer <token>` header.

---

## Hosting later (rough plan)

- **Frontend** → Vercel or Netlify (free). `npm run build` outputs `client/dist`.
- **Backend** → Render / Railway / Fly.io. Set the same env vars there; point the frontend at its URL.
- **Database** → the same MongoDB Atlas free cluster.
- **Domain** → buy one (~$12/yr) and point it at the frontend host.

Cost at personal-use volume: MongoDB free, hosting free–~$7/mo, Claude API a few cents/month.
