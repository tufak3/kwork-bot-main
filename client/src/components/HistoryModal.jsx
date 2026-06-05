import { useState, useEffect } from 'react';
import { fetchParseHistory } from '../api';

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '< 1 с';
  if (seconds < 60) return `${seconds} с`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
}

export default function HistoryModal({ open, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchParseHistory()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const totalOrders = sessions.reduce((sum, s) => sum + (s.orders_found || 0), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📊 История парсинга</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="history-loading">
              <div className="spinner" />
              <span>Загрузка...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="history-empty">
              <p>История пуста</p>
              <p className="empty-hint">После первого запуска парсинга здесь появятся записи</p>
            </div>
          ) : (
            <>
              <div className="history-summary">
                Всего сессий: <strong>{sessions.length}</strong> &nbsp;|&nbsp;
                Суммарно найдено: <strong>{totalOrders}</strong>
              </div>
              <div className="history-list">
                {sessions.map((s) => (
                  <div key={s.id} className="history-item">
                    <div className="history-date">{formatDate(s.start_time)}</div>
                    <div className="history-times">
                      <span>Старт: <strong>{formatTime(s.start_time)}</strong></span>
                      <span>Финиш: <strong>{formatTime(s.end_time)}</strong></span>
                      <span>Длительность: <strong>{formatDuration(s.duration_seconds)}</strong></span>
                    </div>
                    <div className="history-found">
                      Найдено заказов: <strong>{s.orders_found}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
