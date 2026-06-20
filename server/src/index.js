import 'dotenv/config';
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
import { aiConfigured } from './lib/anthropic.js';

const app = express();
app.use(cors());
// base64 images can be large — raise the JSON body limit
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: aiConfigured() });
});

app.use('/api/auth', authRoutes);
app.use('/api/days', dayRoutes);
app.use('/api/products', productRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/ai', aiRoutes);

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
    });
  })
  .catch((err) => {
    console.error('✗ Failed to start:', err.message);
    process.exit(1);
  });
