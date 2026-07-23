// Thin fetch wrapper. Stores the JWT in localStorage and attaches it to every request.
const TOKEN_KEY = 'ketolog:token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
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
    throw new Error(data.error || 'שגיאה');
  }
  return data;
}

export const api = {
  // auth
  register: (email, password) => request('POST', '/auth/register', { email, password }),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  forgotPassword: (email) => request('POST', '/auth/forgot-password', { email }),
  me: () => request('GET', '/auth/me'),
  updateProfile: (fields) => request('PATCH', '/auth/me', fields),
  // wipe the journal (days + insights) after typed confirmation — fresh day 1
  resetAccount: (confirm) => request('POST', '/auth/reset-account', { confirm }),

  // days + meals
  getDays: () => request('GET', '/days'),
  upsertDay: (date, fields) => request('PUT', `/days/${date}`, fields),
  setMetric: (date, field, value) => request('PATCH', `/days/${date}/metrics`, { field, value }),
  addMeal: (date, meal) => request('POST', `/days/${date}/meals`, meal),
  updateMeal: (date, mealId, patch) => request('PATCH', `/days/${date}/meals/${mealId}`, patch),
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

  // bring-your-own AI key + owner's AI on/off preview toggle
  saveAiKey: (key) => request('POST', '/ai/key', { key }),
  deleteAiKey: () => request('DELETE', '/ai/key'),
  setAiOptOut: (off) => request('POST', '/ai/opt-out', { off }),
  // own AI spend (this month + all-time) and the self-set monthly budget
  getMyAiUsage: () => request('GET', '/ai/usage'),
  setAiBudget: (usd) => request('POST', '/ai/budget', { usd }),

  // bug reports — filed with the account's name/email attached server-side
  reportBug: (description, images) => request('POST', '/bugs', { description, images }),
  getMyBugReports: () => request('GET', '/bugs/mine'),

  // in-app messages (bug replies, system announcements) + unread badge
  getMessages: () => request('GET', '/messages'),
  markMessagesRead: () => request('POST', '/messages/read-all'),

  // admin — per-user AI cost breakdown (admin accounts only)
  getAdminUsage: () => request('GET', '/admin/usage'),
  // admin — bug reports: list, reply (reply lands in the reporter's messages)
  getAdminBugs: () => request('GET', '/admin/bugs'),
  replyToBug: (id, reply, status) => request('POST', `/admin/bugs/${id}/reply`, { reply, status }),
  // admin — system message to one user (email) or broadcast to everyone
  sendSystemMessage: (title, body, email) =>
    request('POST', '/admin/messages', { title, body, email }),
};
