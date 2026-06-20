const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Bot
export const startBot = () => request('/bot/start', { method: 'POST' });
export const stopBot = () => request('/bot/stop', { method: 'POST' });
export const getStatus = () => request('/bot/status');
export const fetchParseHistory = (limit = 50) => request(`/bot/history?limit=${limit}`);
export const fetchAnalyticsDiff = () => request('/bot/analytics/diff');
export const getUserMode = () => request('/bot/user-mode');
export const setUserMode = (mode) => request('/bot/user-mode', { method: 'POST', body: JSON.stringify({ mode }) });

// Orders
export const fetchOrders = (params = {}) => {
  const q = new URLSearchParams();
  if (params.tab) q.set('tab', params.tab);
  if (params.minRelevance) q.set('minRelevance', params.minRelevance);
  if (params.favoritesOnly) q.set('favoritesOnly', '1');
  const qs = q.toString();
  return request('/orders' + (qs ? '?' + qs : ''));
};
export const fetchTabCounts = () => request('/orders/counts');
export const ignoreOrder = (id) => request(`/orders/${id}/ignore`, { method: 'POST' });
export const unignoreOrder = (id) => request(`/orders/${id}/unignore`, { method: 'POST' });
export const favoriteOrder = (id, value) =>
  request(`/orders/${id}/favorite`, { method: 'POST', body: JSON.stringify({ value }) });
export const generateAi = (id, force = false) =>
  request(`/orders/${id}/generate`, { method: 'POST', body: JSON.stringify({ force }) });
export const deleteAiResponse = (id) => request(`/orders/${id}/ai`, { method: 'DELETE' });
export const clearOrders = () => request('/orders/clear', { method: 'POST' });
export const clearRespondedOrders = () => request('/orders/clear-responded', { method: 'POST' });
export const hideAllOrders = (tab) => request('/orders/hide-all', { method: 'POST', body: JSON.stringify({ tab }) });
export const generateFromUrl = (url) =>
  request('/orders/from-url', { method: 'POST', body: JSON.stringify({ url }) });

// Settings
export const getSettings = () => request('/settings');
export const updateSetting = (key, value) =>
  request('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) });
export const updateSettingsBulk = (updates) =>
  request('/settings/bulk', { method: 'PUT', body: JSON.stringify({ updates }) });
export const getDefaultPrompt = () => request('/settings/default-prompt');
export const getDefaultExclude = () => request('/settings/default-exclude');

// Groq multi-keys
export const getGroqKeys = () => request('/settings/groq-keys');
export const addGroqKey = (key) => request('/settings/groq-keys', { method: 'POST', body: JSON.stringify({ key }) });
export const deleteGroqKey = (index) => request(`/settings/groq-keys/${index}`, { method: 'DELETE' });
