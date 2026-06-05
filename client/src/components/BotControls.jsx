import { startBot, stopBot, clearOrders, setUserMode } from '../api';
import MoscowClock from './MoscowClock';

export default function BotControls({
  status,
  stats,
  autoInfo,
  userMode,
  onClear,
  onSettingsOpen,
  onHistoryOpen,
  onAnalyticsOpen,
  onUserModeChange,
  onToast,
}) {
  const handleStart = async () => {
    try { await startBot(); }
    catch (e) { onToast?.(e.message || 'Не удалось запустить', 'error'); }
  };

  const handleStop = async () => {
    try { await stopBot(); }
    catch (e) { onToast?.(e.message || 'Не удалось остановить', 'error'); }
  };

  const handleClear = async () => {
    if (!window.confirm('Очистить базу заказов? Все карточки и кэш AI-откликов будут удалены.')) return;
    try {
      await clearOrders();
      if (onClear) onClear();
      onToast?.('База очищена', 'info');
    } catch (e) {
      onToast?.(e.message || 'Не удалось очистить', 'error');
    }
  };

  const handleModeToggle = async () => {
    const next = userMode === 'working' ? 'not_working' : 'working';
    try {
      await setUserMode(next);
      onUserModeChange?.(next);
      onToast?.(
        next === 'working'
          ? '🟢 Режим «Работаю» — уведомления каждые 3 часа'
          : '🔴 Режим «Не работаю» — уведомления отключены',
        'info'
      );
    } catch (e) {
      onToast?.(e.message || 'Не удалось сменить режим', 'error');
    }
  };

  const statusColor = {
    running: '#22c55e',
    paused: '#eab308',
    stopped: '#6b7280',
  }[status] || '#6b7280';

  const statusText = {
    running: 'Работает',
    paused: 'Пауза',
    stopped: 'Остановлен',
  }[status] || 'Остановлен';

  const autoOn = autoInfo?.autoMode;
  const cacheHits = stats?.cacheHits || 0;
  const aiGen = stats?.aiGenerations || 0;
  const aiCached = stats?.aiCached || 0;
  const costSavedUsd = (cacheHits * 0.0003).toFixed(3);
  const isWorking = userMode === 'working';

  return (
    <header className="controls">
      <div className="controls-top">
        <div className="controls-title">
          <h1>Kwork Monitor</h1>
          <div className="status-badge" style={{ '--status-color': statusColor }}>
            <span className="status-dot" />
            {statusText}
          </div>
          {autoOn && (
            <div className="status-badge auto-badge" title={`Авто-режим: каждые ${autoInfo.autoIntervalMinutes} мин`}>
              <span>⟳</span> Auto {autoInfo.autoIntervalMinutes}м
            </div>
          )}
        </div>

        <div className="controls-top-right">
          <MoscowClock />
          <button className="btn-icon" onClick={onSettingsOpen} title="Настройки (S)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="controls-row">
        <div className="controls-buttons">
          <button className="btn btn-start" onClick={handleStart} disabled={status === 'running'} title="Запустить парсинг">
            ▶ Start
          </button>
          <button className="btn btn-stop" onClick={handleStop} disabled={status !== 'running'} title="Остановить">
            ■ Stop
          </button>
          <button className="btn btn-clear" onClick={handleClear} title="Очистить базу">
            Clear
          </button>
          <button
            className={'btn btn-mode' + (isWorking ? ' btn-mode-active' : '')}
            onClick={handleModeToggle}
            title={isWorking ? 'Сейчас: Работаю — нажмите чтобы отключить уведомления' : 'Сейчас: Не работаю — нажмите для активации'}
          >
            {isWorking ? '🟢 Работаю' : '🔴 Не работаю'}
          </button>
          <button className="btn btn-outline" onClick={onHistoryOpen} title="История парсинга">
            📊 История
          </button>
          <button className="btn btn-outline" onClick={onAnalyticsOpen} title="Аналитика разница">
            📈 Разница
          </button>
        </div>

        {stats && (
          <div className="controls-stats">
            <span>Найдено: <strong>{stats.total}</strong></span>
            <span>За сегодня: <strong>{stats.today}</strong></span>
            <span title="Сгенерировано AI-откликов">AI: <strong>{aiGen}</strong></span>
            <span title="Сохранённые отклики без расхода API">Кэш: <strong>{aiCached}</strong></span>
            <span title="Сколько раз ответ взят из кэша">
              Сэкономлено: <strong>{cacheHits}</strong> {cacheHits > 0 && <em>(~${costSavedUsd})</em>}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
