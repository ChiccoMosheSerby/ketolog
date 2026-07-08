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

  // admin — per-user AI cost breakdown (admin accounts only)
  getAdminUsage: () => request('GET', '/admin/usage'),
  // admin — the global learned-product catalog (map of every food logged)
  getAdminCatalog: () => request('GET', '/admin/catalog'),
  // admin — catalog optimization: AI duplicate scan (manual-only), merge
  // requests (approve/reject; every system proposal awaits the admin), manual
  // merges/rephrases, and manually-created catalog products
  scanCatalog: (opts) => request('POST', '/admin/catalog/optimize', opts || {}),
  // feature kill switch: OFF = estimate meals exactly as before the catalog
  // feature existed; ON = serve confident meals from the catalog with no AI
  setCatalogResolver: (enabled) => request('POST', '/admin/catalog/resolver', { enabled }),
  getCatalogMerges: (status) =>
    request('GET', `/admin/catalog/merges${status ? `?status=${status}` : ''}`),
  resolveCatalogMerge: (id, decision, canonicalKey) =>
    request('POST', `/admin/catalog/merges/${id}`, { decision, canonicalKey }),
  createCatalogMerge: (canonicalKey, phrases) =>
    request('POST', '/admin/catalog/merges', { canonicalKey, phrases }),
  createCatalogItem: (item) => request('POST', '/admin/catalog/items', item),
  updateCatalogItem: (key, patch) =>
    request('PATCH', `/admin/catalog/items/${encodeURIComponent(key)}`, patch),
  // remove an item entirely (its folded rephrases become independent again)
  deleteCatalogItem: (key) =>
    request('DELETE', `/admin/catalog/items/${encodeURIComponent(key)}`),
  // detach a rephrase from its main item (rename = detach + re-add)
  removeCatalogAlias: (aliasKey) =>
    request('DELETE', `/admin/catalog/aliases/${encodeURIComponent(aliasKey)}`),
};
