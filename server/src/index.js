import 'dotenv/config';
import dns from 'node:dns';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.js';
import dayRoutes from './routes/days.js';
import productRoutes from './routes/products.js';
import templateRoutes from './routes/templates.js';
import aiRoutes from './routes/ai.js';
import whatsappRoutes from './routes/whatsapp.js';
import { aiConfigured } from './lib/anthropic.js';
import { whatsappConfigured } from './lib/whatsapp.js';
import { rateLimit } from './middleware/rateLimit.js';

// Fail fast on a missing/weak signing secret rather than silently 500-ing every
// auth request (or, worse, signing tokens with a guessable key).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('✗ JWT_SECRET must be set to a long random string (>= 32 chars).');
  process.exit(1);
}

// Prefer IPv4 for all outbound DNS. Render instances have no working IPv6
// egress, so resolving a host's IPv6 (AAAA) record first makes outbound TLS
// (notably Gmail SMTP) fail with ENETUNREACH / connection timeouts.
dns.setDefaultResultOrder('ipv4first');

const app = express();

// Behind Render's proxy: trust the first hop so req.ip is the real client IP
// (needed for correct per-client rate limiting), but no further (no spoofing).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Restrict cross-origin access to an explicit allowlist. The client is served
// from the same origin as the API (and the dev server proxies /api), so cross-
// origin requests are never needed in normal use — override via CORS_ORIGINS
// (comma-separated) only if you host the client elsewhere.
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://ketolog.onrender.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5173', 'http://localhost:4000');
}
app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / non-browser clients (no Origin header)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  })
);

// Minimal hardening headers (clickjacking, MIME sniffing, referrer leakage, TLS).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-DNS-Prefetch-Control', 'off');
  res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// base64 images can be large — raise the JSON body limit
app.use(express.json({ limit: '12mb' }));
// the approval-confirmation page posts a small urlencoded form
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: aiConfigured() });
});

// The AI routes call paid third-party APIs (Anthropic / OpenAI), so cap how fast
// any single client can hit them regardless of which AI endpoint they use.
app.use('/api/ai', rateLimit({ name: 'ai', windowMs: 60_000, max: 30 }));

app.use('/api/auth', authRoutes);
app.use('/api/days', dayRoutes);
app.use('/api/products', productRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/ai', aiRoutes);
// Twilio's inbound WhatsApp webhook. Public (secured by Twilio's request
// signature, not a bearer token) and sends application/x-www-form-urlencoded,
// which the urlencoded parser above already handles.
app.use('/api/whatsapp', whatsappRoutes);

// In production, serve the built React app from the same origin as the API
// (the client uses relative /api paths, so one origin means zero CORS setup).
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-/api route returns index.html
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// fallback error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'שגיאת שרת' });
});

const PORT = process.env.PORT || 4000;

connectDB(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✓ KetoLog API on http://localhost:${PORT}`);
      console.log(`  AI ${aiConfigured() ? 'enabled' : 'DISABLED (set ANTHROPIC_API_KEY)'}`);
      console.log(`  WhatsApp ${whatsappConfigured() ? 'enabled' : 'DISABLED (set TWILIO_* vars)'}`);
    });
  })
  .catch((err) => {
    console.error('✗ Failed to start:', err.message);
    process.exit(1);
  });
