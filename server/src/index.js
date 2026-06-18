import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.js';
import dayRoutes from './routes/days.js';
import productRoutes from './routes/products.js';
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
app.use('/api/ai', aiRoutes);

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
