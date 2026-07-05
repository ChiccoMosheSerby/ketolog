// Thin fetch wrapper. Stores the JWT in localStorage and attaches it to every request.
import i18n from './i18n.js';

const TOKEN_KEY = 'ketolog:token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

// `langOverride` lets the caller pin the request language regardless of the
// current UI language — used by register(), whose response language must follow
// the sign-up form's selection before any account language exists (X-App-Lang
// ordering). All other calls derive it from the active UI language.
async function request(method, path, body, langOverride) {
  const headers = { 'Content-Type': 'application/json' };
  headers['X-App-Lang'] = langOverride || i18n.language || 'he';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new Error(data.error || i18n.t('common.error'));
  }
  return data;
}

export const api = {
  // auth
  register: (email, password, language) =>
    request('POST', '/auth/register', { email, password, language }, language),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  forgotPassword: (email) => request('POST', '/auth/forgot-password', { email }),
  me: () => request('GET', '/auth/me'),
  updateProfile: (fields) => request('PATCH', '/auth/me', fields),

  // days + meals
  getDays: () => request('GET', '/days'),
  upsertDay: (date, fields) => request('PUT', `/days/${date}`, fields),
  setMetric: (date, field, value) => request('PATCH', `/days/${date}/metrics`, { field, value }),
  addMeal: (date, meal) => request('POST', `/days/${date}/meals`, meal),
  deleteMeal: (date, mealId) => request('DELETE', `/days/${date}/meals/${mealId}`),

  // products
  getProducts: () => request('GET', '/products'),
  addProduct: (p) => request('POST', '/products', p),
  updateProduct: (id, patch) => request('PATCH', `/products/${id}`, patch),
  deleteProduct: (id) => request('DELETE', `/products/${id}`),

  // meal templates
  getTemplates: () => request('GET', '/templates'),
  addTemplate: (t) => request('POST', '/templates', t),
  deleteTemplate: (id) => request('DELETE', `/templates/${id}`),

  // ai
  estimateMeal: (desc) => request('POST', '/ai/estimate-meal', { desc }),
  estimateImage: (image, mediaType, unit) =>
    request('POST', '/ai/estimate-image', { image, mediaType, unit }),
  scanBarcode: (barcode, unit) => request('POST', '/ai/barcode', { barcode, unit }),
  transcribe: (audio, mimeType) => request('POST', '/ai/transcribe', { audio, mimeType }),

  // assistant chat
  getChat: () => request('GET', '/ai/chat'),
  sendChat: ({ conversationId, text, image }) =>
    request('POST', '/ai/chat', { conversationId, text, image }),
  resolveAction: (conversationId, actionId, decision) =>
    request('POST', `/ai/chat/${conversationId}/actions/${actionId}`, { decision }),

  // AI insights — auto-generated weekly/monthly report history
  getInsights: (today) => request('GET', `/ai/insights${today ? `?today=${today}` : ''}`),
  markInsightSeen: (id) => request('POST', `/ai/insights/${id}/seen`),

  // admin — per-user AI cost breakdown (admin accounts only)
  getAdminUsage: () => request('GET', '/admin/usage'),
};
