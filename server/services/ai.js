const Groq = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const logger = require('../logger');
const keyManager = require('./groqKeyManager');

const hotCache = new Map();
const HOT_CACHE_MAX = 200;

function createGroqClient(apiKey) {
  return new Groq({ apiKey });
}

function createClaudeClient() {
  const apiKey = db.getSetting('claude_api_key');
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function extractInstructions(description) {
  if (!description) return [];
  const out = [];

  const bracketRe = /[\[\(]\s*((?:напиш|опиш|укаж|расскаж|ответь|перечисл|пришл)[^\]\)]{3,200})[\]\)]/gi;
  let m;
  while ((m = bracketRe.exec(description)) !== null) out.push(m[1].trim());

  const lines = description.split(/[\.\n!?]+/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^(напиш|опиш|укаж|расскаж|ответьт|перечисл|пришл)/i.test(t) && t.length > 8 && t.length < 220) {
      out.push(t);
    }
  }

  const seen = new Set();
  return out.filter(x => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
}

function buildUserMessage(order) {
  const title = (order.title || '').trim();
  const desc = (order.description || '').trim().slice(0, 1500);
  const budget = (order.budget || '').trim() || 'не указан';
  const instructions = extractInstructions(desc);

  let msg = `=== ЗАГОЛОВОК ===\n${title}\n\n=== ОПИСАНИЕ (читай внимательно, отвечай на конкретику) ===\n${desc || '(описание не предоставлено)'}\n\n=== БЮДЖЕТ ===\n${budget}`;

  if (instructions.length) {
    msg += `\n\n=== ПРЯМЫЕ ИНСТРУКЦИИ ОТ ЗАКАЗЧИКА (на эти пункты НУЖНО прямо отреагировать в отклике) ===\n` +
      instructions.map((i, idx) => `${idx + 1}. ${i}`).join('\n');
  }

  msg += `\n\n=== ЗАДАЧА ===\nНапиши отклик строго по системному промпту. Минимум ДВЕ конкретные детали из ОПИСАНИЯ выше должны быть упомянуты в отклике (не из заголовка). Если есть прямые инструкции от заказчика — отреагируй на них в первую очередь.`;

  return msg;
}

// --- Groq helpers ---

function extractGroqText(choice) {
  if (!choice) return '';
  const msg = choice.message || {};
  if (msg.content && msg.content.trim()) return msg.content.trim();
  if (msg.reasoning && msg.reasoning.trim()) return msg.reasoning.trim();
  return '';
}

async function callGroqModel(client, { model, prompt, userMsg, reasoning, maxTokens, temperature }) {
  const params = {
    model,
    max_tokens: maxTokens,
    temperature,
    top_p: 0.9,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userMsg },
    ],
  };
  if (reasoning && model.startsWith('openai/gpt-oss')) {
    params.reasoning_effort = reasoning;
  }
  const completion = await client.chat.completions.create(params);
  return {
    text: extractGroqText(completion.choices[0]),
    finishReason: completion.choices[0]?.finish_reason || '',
    usage: completion.usage || null,
  };
}

async function generateGroq(order, prompt, model) {
  const userMsg = buildUserMessage(order);
  const MAX_KEY_ATTEMPTS = keyManager.getKeys().length || 1;

  for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
    const apiKey = keyManager.getActiveKey();
    if (!apiKey) {
      const msg = 'Все Groq API ключи исчерпаны или недоступны. Добавьте новые ключи в настройках.';
      logger.error(`[AI/Groq] ${msg}`);
      return { error: msg };
    }

    const client = createGroqClient(apiKey);

    try {
      let result = await callGroqModel(client, {
        model, prompt, userMsg, reasoning: 'medium', maxTokens: 2200, temperature: 0.75,
      });

      if (!result.text) {
        logger.warn(`[AI/Groq] Пустой ответ (finish=${result.finishReason}), retry reasoning=low`);
        result = await callGroqModel(client, {
          model, prompt, userMsg, reasoning: 'low', maxTokens: 1500, temperature: 0.7,
        });
      }

      if (!result.text) {
        result = await callGroqModel(client, {
          model, prompt, userMsg, reasoning: null, maxTokens: 1200, temperature: 0.7,
        });
      }

      if (!result.text) {
        return { error: `Groq: модель вернула пустой ответ (finish_reason: ${result.finishReason || 'unknown'}).` };
      }

      keyManager.markKeySuccess(apiKey);
      return { text: result.text };

    } catch (err) {
      const errMsg = err.message || String(err);
      logger.error(`[AI/Groq] Ошибка ключа ${keyManager.maskKey(apiKey)}: ${errMsg}`);
      keyManager.markKeyFailed(apiKey, errMsg);

      const isRetryable = /rate.?limit|quota|limit exceeded|blocked|forbidden|503|502|429/i.test(errMsg);
      if (isRetryable) {
        const nextKey = keyManager.rotateToNext();
        if (!nextKey) {
          return { error: 'Все Groq API ключи исчерпаны. Добавьте новые ключи в настройках.' };
        }
        logger.info(`[AI/Groq] Переключаюсь на следующий ключ: ${keyManager.maskKey(nextKey)}`);
        continue;
      }

      return { error: errMsg };
    }
  }

  return { error: 'Не удалось выполнить запрос — все ключи вернули ошибки.' };
}

// --- Claude helpers ---

async function generateClaude(order, prompt, model) {
  const client = createClaudeClient();
  if (!client) return { error: 'Claude API ключ не задан в настройках' };

  const userMsg = buildUserMessage(order);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: prompt,
      messages: [{ role: 'user', content: userMsg }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock ? textBlock.text.trim() : '';

    if (!text) {
      return { error: `Claude: модель вернула пустой ответ (stop_reason: ${response.stop_reason || 'unknown'}).` };
    }

    return { text };
  } catch (err) {
    logger.error(`[AI/Claude] Ошибка: ${err.message}`);
    return { error: err.message || 'Ошибка Claude API' };
  }
}

// --- Main entry point ---

async function generateResponse(order, { force = false, persist = true } = {}) {
  if (persist && !force && hotCache.has(order.id)) {
    db.incrementCacheHits();
    return { response: hotCache.get(order.id), cached: true };
  }

  if (persist && !force) {
    const saved = db.getAiResponse(order.id);
    if (saved && saved.response) {
      if (hotCache.size >= HOT_CACHE_MAX) hotCache.delete(hotCache.keys().next().value);
      hotCache.set(order.id, saved.response);
      db.incrementCacheHits();
      return { response: saved.response, cached: true };
    }
  }

  try {
    const prompt = db.getSetting('ai_prompt') || 'Напиши отклик на заказ.';
    const model = db.getSetting('ai_model') || 'openai/gpt-oss-120b';
    const provider = db.getSetting('ai_provider') || 'groq';

    let result;
    if (provider === 'claude') {
      result = await generateClaude(order, prompt, model);
    } else {
      result = await generateGroq(order, prompt, model);
    }

    if (result.error) return { error: result.error };

    if (persist) {
      db.saveAiResponse(order.id, result.text, model);
      if (hotCache.size >= HOT_CACHE_MAX) hotCache.delete(hotCache.keys().next().value);
      hotCache.set(order.id, result.text);
      db.incrementAiGenerations();
    }

    return { response: result.text, cached: false };
  } catch (err) {
    logger.error(`[AI] Неожиданная ошибка: ${err.message}`);
    return { error: err.message || 'Ошибка генерации' };
  }
}

function clearCache() {
  hotCache.clear();
}

module.exports = { generateResponse, clearCache };
