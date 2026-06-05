const db = require('../db');
const logger = require('../logger');

// Per-key state: { disabled: bool, disabledUntil: timestamp, errorCount: number }
const keyState = new Map();
const DISABLE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
let currentIndex = 0;
let _io = null;

function setIo(io) { _io = io; }

function getKeys() {
  let keys = db.getGroqKeys();
  // Fallback: migrate legacy single key
  if (!keys || keys.length === 0) {
    const legacy = db.getSetting('groq_api_key');
    if (legacy) {
      keys = [legacy];
      db.setGroqKeys(keys);
    }
  }
  return keys.filter(k => typeof k === 'string' && k.trim());
}

function getKeyInfo(key) {
  if (!keyState.has(key)) keyState.set(key, { disabled: false, disabledUntil: 0, errorCount: 0 });
  return keyState.get(key);
}

function isKeyAvailable(key) {
  const info = getKeyInfo(key);
  if (!info.disabled) return true;
  if (Date.now() >= info.disabledUntil) {
    // Auto-restore after cooldown
    info.disabled = false;
    info.errorCount = 0;
    logger.info(`[GroqKeys] Ключ ${maskKey(key)} восстановлен после кулдауна`);
    notify(`Groq ключ ${maskKey(key)} восстановлен и снова активен`, 'info');
    return true;
  }
  return false;
}

function getActiveKey() {
  const keys = getKeys();
  if (keys.length === 0) return null;

  // Try to find a working key starting from currentIndex
  for (let i = 0; i < keys.length; i++) {
    const idx = (currentIndex + i) % keys.length;
    if (isKeyAvailable(keys[idx])) {
      currentIndex = idx;
      return keys[idx];
    }
  }
  return null; // all keys exhausted
}

function rotateToNext() {
  const keys = getKeys();
  if (keys.length === 0) return null;
  currentIndex = (currentIndex + 1) % keys.length;
  return getActiveKey();
}

function markKeyFailed(key, reason) {
  const info = getKeyInfo(key);
  info.errorCount = (info.errorCount || 0) + 1;

  const isFatal = /rate.?limit|quota|limit exceeded|blocked|forbidden|invalid.*key|unauthorized/i.test(reason || '');

  if (isFatal || info.errorCount >= 3) {
    info.disabled = true;
    info.disabledUntil = Date.now() + DISABLE_DURATION_MS;
    const msg = `Groq ключ ${maskKey(key)} отключён на 10 мин (${reason || 'ошибка'})`;
    logger.warn(`[GroqKeys] ${msg}`);
    notify(msg, 'error');
  } else {
    logger.warn(`[GroqKeys] Ключ ${maskKey(key)} вернул ошибку (попытка ${info.errorCount}): ${reason}`);
  }
}

function markKeySuccess(key) {
  const info = getKeyInfo(key);
  info.errorCount = 0;
}

function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

function notify(message, type = 'info') {
  if (_io) _io.emit('key_manager_event', { message, type, ts: Date.now() });
}

function getStatus() {
  const keys = getKeys();
  return keys.map((key, idx) => {
    const info = getKeyInfo(key);
    const active = isKeyAvailable(key);
    return {
      index: idx,
      masked: maskKey(key),
      active,
      errorCount: info.errorCount || 0,
      disabledUntil: info.disabledUntil || 0,
    };
  });
}

module.exports = { setIo, getActiveKey, rotateToNext, markKeyFailed, markKeySuccess, getStatus, getKeys, maskKey };
