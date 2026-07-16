// Meal estimation via OpenAI GPT — the alternative engine to Claude. It runs
// the exact same prompt (ketoRules + MEAL_FORMAT from lib/anthropic.js) and
// returns the exact same normalized shape, so the two engines are directly
// comparable and interchangeable everywhere downstream (cache, route, client).
// Like transcribe.js, this calls the OpenAI HTTP API directly — no SDK needed
// for a single JSON-in/JSON-out endpoint.
import { ketoRules, MEAL_FORMAT, extractJson, normalizeMeal } from './anthropic.js';
import { recordOpenAIChatUsage } from './usage.js';

export const GPT_MODEL = () => process.env.GPT_MODEL || 'gpt-5.1';

export function gptConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function estimateMealGPT(desc, products = [], ctx = {}) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GPT_MODEL(),
      // GPT-5-family models take max_completion_tokens (max_tokens is rejected)
      // and only support the default temperature, so neither knob is set — same
      // as the Claude estimator, consistency comes from the prompt's reference
      // values plus deriving totals from the per-item breakdown (normalizeMeal).
      max_completion_tokens: 5000,
      // The prompt already demands raw JSON; json_object mode makes it a hard
      // guarantee instead of a convention.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ketoRules(products) + MEAL_FORMAT },
        { role: 'user', content: desc },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`openai chat ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  recordOpenAIChatUsage({
    userId: ctx.userId,
    kind: 'estimate_meal_gpt',
    model: GPT_MODEL(),
    usage: data.usage,
  });
  const text = data.choices?.[0]?.message?.content || '';
  return normalizeMeal(extractJson(text));
}
