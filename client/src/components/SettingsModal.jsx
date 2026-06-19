import { useState, useEffect } from 'react';
import { getSettings, updateSettingsBulk, getDefaultPrompt, getDefaultExclude, getGroqKeys, addGroqKey, deleteGroqKey } from '../api';

const GROQ_MODELS = [
  { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (рекомендуется — лучшее качество)' },
  { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (дешевле, чуть проще)' },
  { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
];

const CLAUDE_MODELS = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 (максимальное качество)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (баланс цены и качества)' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (быстрый и дешёвый)' },
];

const OPENAI_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o (рекомендуется — баланс качества и цены)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (быстрый и дешёвый)' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (самый дешёвый)' },
];

const DEFAULT_MODEL_BY_PROVIDER = {
  groq: 'openai/gpt-oss-120b',
  claude: 'claude-opus-4-8',
  openai: 'gpt-4o',
};

export default function SettingsModal({ open, onClose, onToast }) {
  const [form, setForm] = useState({
    queries: '',
    exclude: '',
    prompt: '',
    claudeApiKey: '',
    openaiApiKey: '',
    aiProvider: 'groq',
    model: 'openai/gpt-oss-120b',
    autoMode: false,
    autoInterval: 15,
    minRelevance: 0,
    telegramToken: '',
  });
  const [hasClaudeKey, setHasClaudeKey] = useState(false);
  const [maskedClaudeKey, setMaskedClaudeKey] = useState('');
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [maskedOpenaiKey, setMaskedOpenaiKey] = useState('');
  const [hasTgToken, setHasTgToken] = useState(false);
  const [groqKeys, setGroqKeys] = useState([]);
  const [newGroqKey, setNewGroqKey] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([getSettings(), getGroqKeys()]).then(([s, keysData]) => {
      const provider = s.ai_provider || 'groq';
      setForm({
        queries: (s.search_queries || '').split(',').filter(Boolean).join('\n'),
        exclude: (s.exclude_keywords || '').split(',').filter(Boolean).join('\n'),
        prompt: s.ai_prompt || '',
        claudeApiKey: '',
        openaiApiKey: '',
        aiProvider: provider,
        model: s.ai_model || DEFAULT_MODEL_BY_PROVIDER[provider] || 'openai/gpt-oss-120b',
        autoMode: s.auto_mode === '1',
        autoInterval: parseInt(s.auto_interval_minutes || '15', 10),
        minRelevance: parseInt(s.min_relevance || '0', 10),
        telegramToken: '',
      });
      setHasClaudeKey(!!s.claude_api_key_present);
      setMaskedClaudeKey(s.claude_api_key_masked || '');
      setHasOpenaiKey(!!s.openai_api_key_present);
      setMaskedOpenaiKey(s.openai_api_key_masked || '');
      setHasTgToken(!!s.telegram_bot_token_present);
      setGroqKeys(keysData.keys || []);
      setDirty(false);
    });
  }, [open]);

  const update = (k, v) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const handleProviderChange = (provider) => {
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider] || 'openai/gpt-oss-120b';
    setForm(prev => ({ ...prev, aiProvider: provider, model: defaultModel }));
    setDirty(true);
  };

  const currentModels = form.aiProvider === 'claude'
    ? CLAUDE_MODELS
    : form.aiProvider === 'openai'
      ? OPENAI_MODELS
      : GROQ_MODELS;

  const handleAddGroqKey = async () => {
    const trimmed = newGroqKey.trim();
    if (!trimmed) return;
    setAddingKey(true);
    try {
      const result = await addGroqKey(trimmed);
      setNewGroqKey('');
      const keysData = await getGroqKeys();
      setGroqKeys(keysData.keys || []);
      onToast?.(`Ключ добавлен (всего: ${result.count})`, 'info');
    } catch (e) {
      onToast?.(e.message || 'Не удалось добавить ключ', 'error');
    }
    setAddingKey(false);
  };

  const handleDeleteGroqKey = async (index) => {
    if (!window.confirm(`Удалить Groq ключ #${index + 1}?`)) return;
    try {
      await deleteGroqKey(index);
      const keysData = await getGroqKeys();
      setGroqKeys(keysData.keys || []);
      onToast?.('Ключ удалён', 'info');
    } catch (e) {
      onToast?.(e.message || 'Не удалось удалить ключ', 'error');
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    const updates = [
      { key: 'search_queries', value: form.queries.split('\n').map(s => s.trim()).filter(Boolean).join(',') },
      { key: 'exclude_keywords', value: form.exclude.split('\n').map(s => s.trim()).filter(Boolean).join(',') },
      { key: 'ai_prompt', value: form.prompt },
      { key: 'ai_model', value: form.model },
      { key: 'ai_provider', value: form.aiProvider },
      { key: 'auto_mode', value: form.autoMode ? '1' : '0' },
      { key: 'auto_interval_minutes', value: String(form.autoInterval) },
      { key: 'min_relevance', value: String(form.minRelevance) },
    ];
    if (form.claudeApiKey.trim()) {
      updates.push({ key: 'claude_api_key', value: form.claudeApiKey.trim() });
    }
    if (form.openaiApiKey.trim()) {
      updates.push({ key: 'openai_api_key', value: form.openaiApiKey.trim() });
    }
    if (form.telegramToken.trim()) {
      updates.push({ key: 'telegram_bot_token', value: form.telegramToken.trim() });
    }
    try {
      await updateSettingsBulk(updates);
      onToast?.('Настройки сохранены', 'info');
      setDirty(false);
      setForm(prev => ({ ...prev, claudeApiKey: '', openaiApiKey: '', telegramToken: '' }));
    } catch (e) {
      onToast?.(e.message || 'Не удалось сохранить', 'error');
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Настройки</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* AI Provider */}
          <div className="settings-section">
            <label>AI-провайдер</label>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              {[{ value: 'groq', label: 'Groq' }, { value: 'claude', label: 'Claude (Anthropic)' }, { value: 'openai', label: 'OpenAI' }].map(p => (
                <label key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="aiProvider" value={p.value} checked={form.aiProvider === p.value} onChange={() => handleProviderChange(p.value)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

          {/* Model */}
          <div className="settings-section">
            <label>
              AI-модель{' '}
              <span className="hint">
                {form.aiProvider === 'claude'
                  ? '(Claude Opus 4.8 — лучшее качество)'
                  : form.aiProvider === 'openai'
                    ? '(GPT-4o — баланс качества и цены)'
                    : '(GPT-OSS 120B — лучше всего справляется с задачей)'}
              </span>
            </label>
            <select className="settings-select" value={form.model} onChange={(e) => update('model', e.target.value)}>
              {currentModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* Auto mode */}
          <div className="settings-section settings-row">
            <div style={{ flex: 1 }}>
              <label>Авто-режим <span className="hint">(парсинг по расписанию)</span></label>
              <label className="toggle-row">
                <input type="checkbox" checked={form.autoMode} onChange={(e) => update('autoMode', e.target.checked)} />
                <span>Парсить автоматически каждые</span>
                <input type="number" min="1" max="180" value={form.autoInterval}
                  onChange={(e) => update('autoInterval', Math.max(1, parseInt(e.target.value || '1', 10)))}
                  style={{ width: 70 }} disabled={!form.autoMode} />
                <span>мин</span>
              </label>
            </div>
          </div>

          {/* Min relevance */}
          <div className="settings-section">
            <label>Минимальная релевантность <span className="hint">(ниже порога — не сохранять)</span></label>
            <div className="relevance-row">
              <input type="range" min="0" max="80" step="5" value={form.minRelevance}
                onChange={(e) => update('minRelevance', parseInt(e.target.value, 10))} />
              <div className="relevance-value">
                {form.minRelevance === 0 ? 'все' : form.minRelevance >= 50 ? `≥ ${form.minRelevance} (только высокая)` : form.minRelevance >= 25 ? `≥ ${form.minRelevance} (от средней)` : `≥ ${form.minRelevance} (от низкой)`}
              </div>
            </div>
          </div>

          {/* Search queries */}
          <div className="settings-section">
            <label>Поисковые запросы <span className="hint">(каждый с новой строки)</span></label>
            <textarea value={form.queries} onChange={(e) => update('queries', e.target.value)} rows={6} />
          </div>

          {/* Exclude keywords */}
          <div className="settings-section">
            <label>
              Исключающие слова <span className="hint">(каждое с новой строки)</span>
              <button type="button" className="btn-link" style={{ float: 'right' }}
                onClick={async () => {
                  if (!window.confirm('Заменить на рекомендованный список?')) return;
                  try {
                    const { exclude } = await getDefaultExclude();
                    update('exclude', exclude.split(',').filter(Boolean).join('\n'));
                    onToast?.('Загружен рекомендованный список. Не забудьте сохранить.', 'info');
                  } catch (e) { onToast?.(e.message || 'Не удалось загрузить', 'error'); }
                }}>
                ↻ Сбросить к рекомендованному
              </button>
            </label>
            <textarea value={form.exclude} onChange={(e) => update('exclude', e.target.value)} rows={6} />
            <div className="hint" style={{ marginTop: 4 }}>{form.exclude.split('\n').filter(Boolean).length} слов в списке</div>
          </div>

          {/* AI Prompt */}
          <div className="settings-section">
            <label>
              AI промпт <span className="hint">(чем короче — тем дешевле)</span>
              <button type="button" className="btn-link" style={{ float: 'right' }}
                onClick={async () => {
                  if (!window.confirm('Заменить на рекомендуемый промпт?')) return;
                  try {
                    const { prompt } = await getDefaultPrompt();
                    update('prompt', prompt);
                    onToast?.('Загружен рекомендуемый промпт. Не забудьте сохранить.', 'info');
                  } catch (e) { onToast?.(e.message || 'Не удалось загрузить', 'error'); }
                }}>
                ↻ Сбросить к рекомендуемому
              </button>
            </label>
            <textarea value={form.prompt} onChange={(e) => update('prompt', e.target.value)} rows={10} className="prompt-textarea" />
            <div className="hint" style={{ marginTop: 4 }}>~{Math.ceil(form.prompt.length / 4)} токенов в системном промпте</div>
          </div>

          {/* Groq multi-keys */}
          <div className="settings-section">
            <label>Groq API Ключи <span className="hint">({groqKeys.length} добавлено — ротация автоматическая)</span></label>
            {groqKeys.length > 0 && (
              <div className="groq-keys-list">
                {groqKeys.map((k) => (
                  <div key={k.index} className="groq-key-row">
                    <span className="groq-key-idx">#{k.index + 1}</span>
                    <span className="groq-key-masked">{k.masked}</span>
                    <button className="btn-delete-key" onClick={() => handleDeleteGroqKey(k.index)} title="Удалить ключ">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="groq-key-add">
              <input
                type="password"
                value={newGroqKey}
                onChange={(e) => setNewGroqKey(e.target.value)}
                placeholder="Добавить новый Groq ключ (gsk_...)"
                onKeyDown={(e) => e.key === 'Enter' && handleAddGroqKey()}
              />
              <button className="btn btn-primary btn-sm" onClick={handleAddGroqKey} disabled={addingKey || !newGroqKey.trim()}>
                {addingKey ? '...' : '+ Добавить'}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              При ошибке лимита ключ отключается на 10 мин и переключается на следующий автоматически
            </div>
          </div>

          {/* Claude key */}
          <div className="settings-section">
            <label>Claude API Key {hasClaudeKey && <span className="hint">(текущий: {maskedClaudeKey})</span>}</label>
            <input type="password" value={form.claudeApiKey} onChange={(e) => update('claudeApiKey', e.target.value)}
              placeholder={hasClaudeKey ? 'Оставьте пустым чтобы не менять' : 'Введите ключ (sk-ant-...)'} />
          </div>

          {/* OpenAI key */}
          <div className="settings-section">
            <label>OpenAI API Key {hasOpenaiKey && <span className="hint">(текущий: {maskedOpenaiKey})</span>}</label>
            <input type="password" value={form.openaiApiKey} onChange={(e) => update('openaiApiKey', e.target.value)}
              placeholder={hasOpenaiKey ? 'Оставьте пустым чтобы не менять' : 'Введите ключ (sk-...)'} />
            <div className="hint" style={{ marginTop: 4 }}>
              Получить на platform.openai.com/api-keys. Выберите провайдер «OpenAI» выше, чтобы использовать.
            </div>
          </div>

          {/* Telegram token */}
          <div className="settings-section">
            <label>Telegram Bot Token {hasTgToken && <span className="hint">(задан)</span>}</label>
            <input type="password" value={form.telegramToken} onChange={(e) => update('telegramToken', e.target.value)}
              placeholder={hasTgToken ? 'Оставьте пустым чтобы не менять' : 'Введите токен от @BotFather'} />
            <div className="hint" style={{ marginTop: 4 }}>
              Также можно задать через переменную окружения TELEGRAM_BOT_TOKEN при деплое
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-outline" onClick={onClose}>Отмена</button>
            <button className="btn btn-primary" onClick={handleSaveAll} disabled={saving || !dirty}>
              {saving ? 'Сохранение…' : dirty ? 'Сохранить всё' : 'Нет изменений'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
