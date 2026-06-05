import { useState, useEffect } from 'react';
import { fetchAnalyticsDiff } from '../api';

export default function AnalyticsModal({ open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAnalyticsDiff()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const indicator = data
    ? data.pct > 0 ? '🟢' : data.pct < 0 ? '🔴' : '⚪'
    : null;

  const pctColor = data
    ? data.pct > 0 ? 'var(--green)' : data.pct < 0 ? 'var(--red)' : 'var(--text-muted)'
    : 'var(--text-muted)';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📈 Аналитика — Разница</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="history-loading">
              <div className="spinner" />
              <span>Загрузка...</span>
            </div>
          ) : !data ? (
            <p style={{ color: 'var(--text-muted)' }}>Не удалось загрузить данные</p>
          ) : (
            <div className="analytics-content">
              <div className="analytics-row">
                <div className="analytics-card">
                  <div className="analytics-card-label">Сегодня</div>
                  <div className="analytics-card-value">{data.today}</div>
                  <div className="analytics-card-sub">{data.todayDate}</div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-label">Вчера</div>
                  <div className="analytics-card-value">{data.yesterday}</div>
                  <div className="analytics-card-sub">{data.yesterdayDate}</div>
                </div>
              </div>

              <div className="analytics-diff">
                <div className="analytics-indicator">{indicator}</div>
                <div className="analytics-pct" style={{ color: pctColor }}>
                  {data.pct > 0 ? '+' : ''}{data.pct}%
                </div>
                {data.diff !== 0 && (
                  <div className="analytics-diff-abs" style={{ color: pctColor }}>
                    ({data.diff > 0 ? '+' : ''}{data.diff} заказов)
                  </div>
                )}
              </div>

              {data.yesterday === 0 && (
                <p className="analytics-hint">
                  Данных за вчера нет — сравнение недоступно
                </p>
              )}

              <div className="analytics-formula">
                Формула: ((Сегодня − Вчера) / Вчера) × 100
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
