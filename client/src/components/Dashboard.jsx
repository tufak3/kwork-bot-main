import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchOrders, fetchTabCounts, getStatus, clearRespondedOrders, hideAllOrders, getUserMode } from '../api';
import { useSocket } from '../hooks/useSocket';
import OrderCard from './OrderCard';
import BotControls from './BotControls';
import SettingsModal from './SettingsModal';
import HistoryModal from './HistoryModal';
import AnalyticsModal from './AnalyticsModal';
import Toast from './Toast';

const TABS = [
  { id: 'inbox', label: 'Входящие' },
  { id: 'responded', label: 'Мои отклики' },
  { id: 'hidden', label: 'Скрытые' },
];

export default function Dashboard() {
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('inbox');
  const [counts, setCounts] = useState({ inbox: 0, responded: 0, hidden: 0, total: 0 });
  const [botStatus, setBotStatus] = useState('stopped');
  const [stats, setStats] = useState({ total: 0, today: 0, aiGenerations: 0, cacheHits: 0, aiCached: 0 });
  const [autoInfo, setAutoInfo] = useState({ autoMode: false, autoIntervalMinutes: 15 });
  const [userMode, setUserMode] = useState('not_working');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('relevance');
  const [minRelevance, setMinRelevance] = useState(0);
  const [showFavOnly, setShowFavOnly] = useState(false);

  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const pushToast = useCallback((msg, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const reloadOrders = useCallback((targetTab = tab) => {
    fetchOrders({ tab: targetTab }).then(setOrders).catch(() => pushToast('Не удалось загрузить заказы', 'error'));
    fetchTabCounts().then(setCounts).catch(() => {});
  }, [tab, pushToast]);

  useEffect(() => {
    reloadOrders('inbox');
    getStatus().then((data) => {
      setBotStatus(data.status);
      setStats(data.stats);
      setAutoInfo({ autoMode: data.autoMode, autoIntervalMinutes: data.autoIntervalMinutes });
    }).catch(() => {});
    getUserMode().then((d) => setUserMode(d.mode)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reloadOrders(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Poll status every 5s always — catches Telegram-triggered runs
  // and recovers from missed socket events after Render sleep/wake
  useEffect(() => {
    const interval = setInterval(() => {
      getStatus().then((data) => {
        setBotStatus(prev => {
          if (prev === 'running' && data.status === 'stopped') reloadOrders(tab);
          return data.status;
        });
        setStats(data.stats);
        setAutoInfo({ autoMode: data.autoMode, autoIntervalMinutes: data.autoIntervalMinutes });
        setUserMode(data.userMode || 'not_working');
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleNewOrder = useCallback((order) => {
    setCounts(prev => ({ ...prev, inbox: prev.inbox + 1, total: prev.total + 1 }));
    setStats((prev) => ({ ...prev, total: prev.total + 1, today: prev.today + 1 }));
    if (tab === 'inbox') {
      setOrders((prev) => {
        if (prev.find((o) => o.id === order.id)) return prev;
        return [order, ...prev];
      });
    }
  }, [tab]);

  const handleBotStatus = useCallback((status) => {
    setBotStatus(status);
    if (status !== 'running') {
      getStatus().then((data) => {
        setStats(data.stats);
        setAutoInfo({ autoMode: data.autoMode, autoIntervalMinutes: data.autoIntervalMinutes });
      }).catch(() => {});
    }
  }, []);

  const handleUserModeSocket = useCallback((data) => {
    setUserMode(data.mode);
  }, []);

  useSocket(handleNewOrder, handleBotStatus, handleUserModeSocket);

  const handleIgnore = (id) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    fetchTabCounts().then(setCounts).catch(() => {});
  };

  const handleAiGenerated = (id) => {
    setStats((prev) => ({ ...prev, aiGenerations: (prev.aiGenerations || 0) + 1 }));
    if (tab === 'inbox') {
      setOrders((prev) => prev.filter((o) => o.id !== id));
    }
    fetchTabCounts().then(setCounts).catch(() => {});
  };

  const handleAiDeleted = () => {
    reloadOrders(tab);
  };

  const handleClear = () => {
    setOrders([]);
    setCounts({ inbox: 0, responded: 0, hidden: 0, total: 0 });
    setStats((prev) => ({ ...prev, total: 0, today: 0, aiCached: 0 }));
  };

  const handleClearResponded = async () => {
    if (!window.confirm('Очистить все отклики? AI-ответы будут удалены, заказы перемещены в «Скрытые».')) return;
    try {
      await clearRespondedOrders();
      setOrders([]);
      fetchTabCounts().then(setCounts).catch(() => {});
      pushToast('Отклики очищены', 'info');
    } catch (e) {
      pushToast(e.message || 'Не удалось очистить', 'error');
    }
  };

  const handleHideAll = async () => {
    try {
      await hideAllOrders(tab);
      setOrders([]);
      fetchTabCounts().then(setCounts).catch(() => {});
      pushToast('Все заказы скрыты', 'info');
    } catch (e) {
      pushToast(e.message || 'Не удалось скрыть', 'error');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('orders-search')?.focus();
      } else if (e.key === 's' || e.key === 'S') {
        setSettingsOpen(true);
      } else if (e.key === 'r' || e.key === 'R') {
        reloadOrders(tab);
      } else if (e.key === '1') setTab('inbox');
      else if (e.key === '2') setTab('responded');
      else if (e.key === '3') setTab('hidden');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, reloadOrders]);

  // Client-side filtering & sorting
  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = orders;
    if (q) {
      list = list.filter(o =>
        (o.title || '').toLowerCase().includes(q) ||
        (o.description || '').toLowerCase().includes(q)
      );
    }
    if (showFavOnly) list = list.filter(o => o.favorite);
    if (minRelevance > 0) list = list.filter(o => Number(o.relevance || 0) >= minRelevance);

    const sorted = [...list];

    // "Мои отклики" всегда по дате генерации отклика DESC (новые сверху)
    if (tab === 'responded') {
      sorted.sort((a, b) => {
        const ta = a.ai_created_at ? new Date(a.ai_created_at).getTime() : 0;
        const tb = b.ai_created_at ? new Date(b.ai_created_at).getTime() : 0;
        return tb - ta;
      });
      return sorted;
    }

    if (sort === 'relevance') {
      sorted.sort((a, b) => (Number(b.relevance || 0) - Number(a.relevance || 0)) ||
        (new Date(b.date_create || 0).getTime() - new Date(a.date_create || 0).getTime()));
    } else if (sort === 'newest') {
      sorted.sort((a, b) => new Date(b.date_create || 0).getTime() - new Date(a.date_create || 0).getTime());
    } else if (sort === 'budget') {
      const parseBudget = (b) => {
        const m = String(b || '').match(/\d+/g);
        return m ? Math.max(...m.map(Number)) : 0;
      };
      sorted.sort((a, b) => parseBudget(b.budget) - parseBudget(a.budget));
    }
    return sorted;
  }, [orders, search, sort, minRelevance, showFavOnly, tab]);

  return (
    <div className="dashboard">
      <BotControls
        status={botStatus}
        stats={stats}
        autoInfo={autoInfo}
        userMode={userMode}
        onClear={handleClear}
        onSettingsOpen={() => setSettingsOpen(true)}
        onHistoryOpen={() => setHistoryOpen(true)}
        onAnalyticsOpen={() => setAnalyticsOpen(true)}
        onUserModeChange={setUserMode}
        onToast={pushToast}
      />

      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={'tab' + (tab === t.id ? ' tab-active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="tab-count">{counts[t.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <input
          id="orders-search"
          type="search"
          className="filter-search"
          placeholder="Поиск по заказам... (нажмите /)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="filter-toggle">
          <input type="checkbox" checked={showFavOnly} onChange={(e) => setShowFavOnly(e.target.checked)} />
          ★ Избранное
        </label>
        {tab !== 'hidden' && orders.length > 0 && (
          <button className="btn btn-hide-all" onClick={handleHideAll} title="Скрыть все заказы на этой вкладке">
            🙈 Скрыть все
          </button>
        )}
        {tab === 'responded' && orders.length > 0 && (
          <button className="btn btn-clear-responded" onClick={handleClearResponded} title="Очистить все отклики">
            🗑 Очистить отклики
          </button>
        )}
        <div className="filter-count">{visibleOrders.length} / {orders.length}</div>
      </div>

      {visibleOrders.length === 0 ? (
        <div className="empty-state">
          {orders.length === 0 ? (
            <>
              {tab === 'inbox' && <>
                <p>Входящих заказов нет</p>
                <p className="empty-hint">Нажмите Start для запуска парсинга</p>
              </>}
              {tab === 'responded' && <>
                <p>Здесь будут заказы, для которых вы сгенерировали отклик</p>
                <p className="empty-hint">Нажмите «Сгенерировать отклик» во вкладке «Входящие»</p>
              </>}
              {tab === 'hidden' && <>
                <p>Скрытых заказов нет</p>
                <p className="empty-hint">Сюда попадают заказы, которые вы убрали крестиком без генерации</p>
              </>}
            </>
          ) : (
            <>
              <p>Под фильтр ничего не подошло</p>
              <p className="empty-hint">Снимите фильтры или измените запрос</p>
            </>
          )}
        </div>
      ) : (
        <div className="orders-grid">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              tab={tab}
              onIgnore={handleIgnore}
              onAiGenerated={handleAiGenerated}
              onAiDeleted={handleAiDeleted}
              onToast={pushToast}
            />
          ))}
        </div>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onToast={pushToast} />
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <AnalyticsModal open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />

      <Toast toasts={toasts} />
    </div>
  );
}
