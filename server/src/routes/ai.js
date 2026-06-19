import { Router } from 'express';
import Product from '../models/Product.js';
import Day from '../models/Day.js';
import Conversation from '../models/Conversation.js';
import { requireAuth } from '../middleware/auth.js';
import { estimateMeal, estimateImage, aiConfigured } from '../lib/anthropic.js';
import { runChatTurn } from '../lib/chatAgent.js';

const router = Router();
router.use(requireAuth);

// POST /api/ai/estimate-meal { desc } -> { net_carbs, fat, protein, breakdown }
router.post('/estimate-meal', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'מפתח ה-AI לא הוגדר בשרת' });
  const desc = (req.body.desc || '').trim();
  if (!desc) return res.status(400).json({ error: 'חסר תיאור הארוחה' });
  try {
    const products = await Product.find({ user: req.userId }).lean();
    const result = await estimateMeal(desc, products);
    res.json(result);
  } catch (err) {
    console.error('estimate-meal failed:', err.message);
    res.status(502).json({ error: 'החישוב האוטומטי נכשל כרגע' });
  }
});

// POST /api/ai/estimate-image { image (base64), mediaType, unit } -> product fields
router.post('/estimate-image', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'מפתח ה-AI לא הוגדר בשרת' });
  const { image, mediaType, unit } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'חסרים נתוני תמונה' });
  try {
    const products = await Product.find({ user: req.userId }).lean();
    const result = await estimateImage(image, mediaType, unit, products);
    res.json(result);
  } catch (err) {
    console.error('estimate-image failed:', err.message);
    res.status(502).json({ error: 'זיהוי התמונה נכשל כרגע' });
  }
});

// ----------------------------------------------------------------------------
// Keto assistant chat
// ----------------------------------------------------------------------------

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const weekday = (iso) => {
  const [y, m, d] = iso.split('-');
  return HE_DAYS[new Date(y, m - 1, d).getDay()];
};

// Turn the stored raw Anthropic message array into a flat list the client can
// render: user/assistant bubbles + any proposed action cards (with their
// resolved status). Tool plumbing (read-tool results) is hidden.
function deriveView(convo) {
  const resolved = convo.resolvedActions || {};
  const view = [];
  for (const msg of convo.messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : null;

    if (msg.role === 'user') {
      // string content (plain typed text) or an array of text/image blocks
      if (typeof msg.content === 'string') {
        if (msg.content.trim()) view.push({ role: 'user', text: msg.content });
        continue;
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const hasImage = blocks.some((b) => b.type === 'image');
      // skip pure tool_result turns (no human-authored content)
      if (text || hasImage) view.push({ role: 'user', text, hasImage });
      continue;
    }

    if (msg.role === 'assistant' && blocks) {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const actions = blocks
        .filter((b) => b.type === 'tool_use' && (b.name === 'propose_meal' || b.name === 'propose_product'))
        .map((b) => ({
          id: b.id,
          type: b.name === 'propose_meal' ? 'meal' : 'product',
          input: b.input,
          status: resolved[b.id] || 'pending',
        }));
      if (text || actions.length) view.push({ role: 'assistant', text, actions });
    }
  }
  return view;
}

// GET /api/ai/chat -> the user's most recent conversation as a renderable view
router.get('/chat', async (req, res) => {
  const convo = await Conversation.findOne({ user: req.userId }).sort({ updatedAt: -1 });
  if (!convo) return res.json({ conversationId: null, title: null, view: [] });
  res.json({ conversationId: convo._id, title: convo.title, view: deriveView(convo) });
});

// POST /api/ai/chat { conversationId?, text, image?: { data, mediaType } }
router.post('/chat', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'מפתח ה-AI לא הוגדר בשרת' });
  const { conversationId, image } = req.body;
  const text = (req.body.text || '').trim();
  if (!text && !image) return res.status(400).json({ error: 'אין הודעה לשליחה' });

  try {
    let convo = conversationId
      ? await Conversation.findOne({ _id: conversationId, user: req.userId })
      : null;
    if (!convo) {
      convo = new Conversation({
        user: req.userId,
        title: text ? text.slice(0, 40) : 'תמונה',
        messages: [],
        resolvedActions: {},
      });
    }

    // build the user message (text + optional image)
    const content = [];
    if (image?.data && image?.mediaType) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
      });
    }
    if (text) content.push({ type: 'text', text });
    convo.messages.push({ role: 'user', content: content.length === 1 && !image ? text : content });

    const { text: reply, actions } = await runChatTurn(convo.messages, req.userId);

    convo.markModified('messages');
    await convo.save();

    res.json({ conversationId: convo._id, reply, actions });
  } catch (err) {
    console.error('chat failed:', err.message);
    res.status(502).json({ error: 'העוזר אינו זמין כרגע' });
  }
});

// POST /api/ai/chat/:id/new -> not needed; omitting conversationId starts fresh.

// POST /api/ai/chat/:id/actions/:actionId { decision: 'add' | 'cancel' }
// Commits (or dismisses) a proposed meal/product, then records it as resolved
// so it can't be double-committed and reloads show the right state.
router.post('/chat/:id/actions/:actionId', async (req, res) => {
  const { id, actionId } = req.params;
  const decision = req.body.decision === 'add' ? 'add' : 'cancel';
  const convo = await Conversation.findOne({ _id: id, user: req.userId });
  if (!convo) return res.status(404).json({ error: 'שיחה לא נמצאה' });

  const resolved = convo.resolvedActions || {};
  if (resolved[actionId]) return res.json({ status: resolved[actionId], already: true });

  // locate the proposal block by its tool_use id
  let block = null;
  for (const m of convo.messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const found = m.content.find((b) => b.type === 'tool_use' && b.id === actionId);
      if (found) {
        block = found;
        break;
      }
    }
  }
  if (!block) return res.status(404).json({ error: 'הצעה לא נמצאה' });

  if (decision === 'cancel') {
    resolved[actionId] = 'cancelled';
    convo.resolvedActions = resolved;
    convo.markModified('resolvedActions');
    await convo.save();
    return res.json({ status: 'cancelled' });
  }

  try {
    const inp = block.input || {};
    if (block.name === 'propose_meal') {
      const date = inp.date || new Date().toISOString().slice(0, 10);
      const existing = await Day.findOne({ user: req.userId, date }).lean();
      const setOnInsert = { user: req.userId, date };
      if (!existing) {
        const count = await Day.countDocuments({ user: req.userId });
        setOnInsert.label = 'יום ' + (count + 1) + ' · ' + weekday(date);
      }
      const meal = {
        time: inp.time || '',
        cat: inp.cat || 'נשנוש / ביניים',
        desc: inp.desc || '',
        carbs: Number(inp.net_carbs) || 0,
        fat: inp.fat == null ? null : Number(inp.fat),
        protein: inp.protein == null ? null : Number(inp.protein),
      };
      const day = await Day.findOneAndUpdate(
        { user: req.userId, date },
        { $push: { meals: meal }, $setOnInsert: setOnInsert },
        { new: true, upsert: true }
      );
      resolved[actionId] = 'added';
      convo.resolvedActions = resolved;
      convo.markModified('resolvedActions');
      await convo.save();
      return res.json({ status: 'added', kind: 'meal', day });
    }

    // propose_product
    if (!inp.key || !String(inp.key).trim()) {
      return res.status(400).json({ error: 'חסר שם למוצר' });
    }
    const product = await Product.create({
      user: req.userId,
      key: String(inp.key).trim(),
      label: inp.label || inp.key,
      unit: inp.unit || 'מנה',
      cat: inp.cat || 'נשנוש / ביניים',
      carbs: Number(inp.carbs) || 0,
      fat: Number(inp.fat) || 0,
      protein: Number(inp.protein) || 0,
    });
    resolved[actionId] = 'added';
    convo.resolvedActions = resolved;
    convo.markModified('resolvedActions');
    await convo.save();
    return res.json({ status: 'added', kind: 'product', product });
  } catch (err) {
    console.error('commit action failed:', err.message);
    return res.status(502).json({ error: 'השמירה נכשלה' });
  }
});

export default router;
