import { useState } from 'react';
import { ignoreOrder, unignoreOrder, generateAi, favoriteOrder, deleteAiResponse } from '../api';
import AiResponse from './AiResponse';

export default function OrderCard({ order, tab, onIgnore, onAiGenerated, onAiDeleted, onToast }) {
  const [aiText, setAiText] = useState(order.ai_response || null);
  const [aiCached, setAiCached] = useState(!!order.ai_response);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [favorite, setFavorite] = useState(!!order.favorite);

  // ❌ behavior per tab:
  //  - inbox     → ignore → moves to "Скрытые"
  //  - responded → delete AI cache + ignore → moves to "Скрытые"
  //  - hidden    → no-op on server; remove from local view only
  const handleClose = async () => {
    setHidden(true);
    try {
      if (tab === 'responded') {
        // Drop AI response so the order leaves "Мои отклики" tab (which keys
        // off ai_response IS NOT NULL), then mark ignored so it lands in
        // "Скрытые" instead of bouncing back to inbox.
        await deleteAiResponse(order.id);
        await ignoreOrder(order.id);
      } else if (tab !== 'hidden') {
        await ignoreOrder(order.id);
      }
      onIgnore?.(order.id);
    } catch (e) {
      setHidden(false);
      onToast?.(e.message || 'Не удалось скрыть', 'error');
    }
  };

  const handleRestore = async () => {
    // Only meaningful on the "hidden" tab — bring back to inbox.
    try {
      await unignoreOrder(order.id);
      setHidden(true);
      onIgnore?.(order.id); // remove from current (hidden) view
      onToast?.('Возвращено во «Входящие»', 'info');
    } catch (e) {
      onToast?.(e.message || 'Не удалось вернуть', 'error');
    }
  };

  const handleFavorite = async () => {
    const next = !favorite;
    setFavorite(next);
    try {
      await favoriteOrder(order.id, next);
    } catch {
      setFavorite(!next);
      onToast?.('Не удалось обновить избранное', 'error');
    }
  };

  const handleGenerate = async (force = false) => {
    if (loading) return;
    if (aiText && !force) return;
    setLoading(true);
    try {
      const data = await generateAi(order.id, force);
      if (data.response) {
        setAiText(data.response);
        setAiCached(!!data.cached);
        if (data.cached) {
          onToast?.('Загружено из кэша (без расхода API)', 'info');
        } else {
          onToast?.('Отклик сгенерирован — перемещён в «Мои отклики»', 'info');
        }
        // Tell parent: this order is now in "responded" and should leave
        // the current view if we're in inbox.
        onAiGenerated?.(order.id);
      }
    } catch (e) {
      onToast?.(e.message || 'Ошибка генерации', 'error');
    }
    setLoading(false);
  };

  const handleRegenerate = async () => {
    if (!window.confirm('Сгенерировать заново? Это потратит токены API.')) return;
    await handleGenerate(true);
  };

  const handleDeleteAi = async () => {
    try {
      await deleteAiResponse(order.id);
      setAiText(null);
      setAiCached(false);
      onAiDeleted?.(order.id);
    } catch {
      onToast?.('Не удалось удалить отклик', 'error');
    }
  };

  if (hidden) return null;

  // Format date
  let dateStr = '';
  if (order.date_create) {
    try {
      const d = new Date(order.date_create);
      if (!isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    } catch {}
  }

  const desc = order.description && order.description.length > 300
    ? order.description.slice(0, 300) + '...'
    : order.description;

  const relevance = Number(order.relevance || 0);
  const relevanceLabel = relevance >= 50 ? 'высокая' : relevance >= 25 ? 'средняя' : relevance > 0 ? 'низкая' : '';
  const relevanceClass = relevance >= 50 ? 'rel-high' : relevance >= 25 ? 'rel-mid' : 'rel-low';

  const isResponded = tab === 'responded';
  const isHidden = tab === 'hidden';

  return (
    <div className={'order-card' + (relevance >= 50 ? ' order-card-hot' : '')}>
      <button
        className="card-close"
        onClick={handleClose}
        title={isResponded ? 'Убрать в «Скрытые» (AI-отклик будет удалён)' : 'Скрыть заказ'}
      >×</button>

      <div className="card-top-row">
        {relevance > 0 && (
          <span className={'rel-badge ' + relevanceClass} title={`Релевантность: ${relevance}/100`}>
            {relevanceLabel}
          </span>
        )}
        <button
          className={'btn-fav' + (favorite ? ' is-fav' : '')}
          onClick={handleFavorite}
          title={favorite ? 'Убрать из избранного' : 'В избранное'}
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>

      <h3 className="card-title">{order.title}</h3>

      {desc && <p className="card-desc">{desc}</p>}

      <div className="card-meta">
        {order.budget && <span className="meta-budget">{order.budget}</span>}
        {dateStr && <span className="meta-date">{dateStr}</span>}
      </div>

      {order.query && (
        <div className="card-query">Запрос: «{order.query}»</div>
      )}

      <div className="card-actions">
        <a
          href={order.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline"
        >
          Открыть на Kwork
        </a>
        {!aiText && (
          <button
            className="btn btn-primary"
            onClick={() => handleGenerate(false)}
            disabled={loading}
          >
            {loading ? 'Генерация…' : 'Сгенерировать отклик'}
          </button>
        )}
        {aiText && (
          <button
            className="btn btn-outline"
            onClick={handleRegenerate}
            disabled={loading}
            title="Перегенерировать (потратит API)"
          >
            ↻
          </button>
        )}
        {isHidden && (
          <button className="btn btn-outline" onClick={handleRestore} title="Вернуть во «Входящие»">
            ↩ Вернуть
          </button>
        )}
      </div>

      {loading && (
        <div className="ai-loading">
          <div className="spinner" />
          <span>AI генерирует отклик…</span>
        </div>
      )}

      {aiText && <AiResponse text={aiText} cached={aiCached} onDelete={handleDeleteAi} />}
    </div>
  );
}
