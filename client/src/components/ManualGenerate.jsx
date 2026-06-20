import { useState } from 'react';
import { generateFromUrl } from '../api';
import AiResponse from './AiResponse';

export default function ManualGenerate({ onToast }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState(null);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError('');
    setOrder(null);
    setResponse(null);

    try {
      const data = await generateFromUrl(trimmed);
      setOrder(data.order);
      setResponse(data.response);
      onToast?.('Отклик сгенерирован', 'info');
    } catch (err) {
      setError(err.message || 'Не удалось обработать ссылку');
      onToast?.(err.message || 'Ошибка', 'error');
    }

    setLoading(false);
  };

  return (
    <div className="manual-generate">
      <form className="manual-form" onSubmit={handleSubmit}>
        <input
          type="url"
          className="manual-input"
          placeholder="Вставьте ссылку на заказ: https://kwork.ru/projects/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
          {loading ? 'Генерация…' : 'Сгенерировать отклик'}
        </button>
      </form>

      <p className="manual-hint">
        Бот сам откроет страницу заказа, прочитает описание и сгенерирует отклик ниже.
      </p>

      {loading && (
        <div className="ai-loading">
          <div className="spinner" />
          <span>Читаю заказ и генерирую отклик…</span>
        </div>
      )}

      {error && <div className="manual-error">⚠ {error}</div>}

      {order && (
        <div className="order-card manual-card">
          <h3 className="card-title">{order.title || 'Без названия'}</h3>
          {order.description && <p className="card-desc">{order.description}</p>}
          <div className="card-meta">
            {order.budget && <span className="meta-budget">{order.budget}</span>}
          </div>
          <div className="card-actions">
            <a href={order.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
              Открыть на Kwork
            </a>
          </div>
          {response && <AiResponse text={response} cached={false} />}
        </div>
      )}
    </div>
  );
}
