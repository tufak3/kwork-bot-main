import { useMemo, useState } from 'react';

export default function AiResponse({ text, cached, onDelete }) {
  const [copied, setCopied] = useState('');

  const { responseText, kworkTitle, costEstimate, deadline } = useMemo(() => {
    const lines = text.split('\n');
    let responseText = '';
    let kworkTitle = '';
    let costEstimate = '';
    let deadline = '';
    let inResponse = true;
    for (const line of lines) {
      if (line.startsWith('Название кворка:')) {
        inResponse = false;
        kworkTitle = line.replace('Название кворка:', '').trim();
      } else if (line.startsWith('Оценка стоимости:')) {
        costEstimate = line.replace('Оценка стоимости:', '').trim();
      } else if (line.startsWith('Срок выполнения:')) {
        deadline = line.replace('Срок выполнения:', '').trim();
      } else if (inResponse && line.trim()) {
        responseText += (responseText ? '\n' : '') + line;
      }
    }
    return { responseText, kworkTitle, costEstimate, deadline };
  }, [text]);

  const copyTo = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };

  const fullText = `${responseText}\n\nНазвание кворка: ${kworkTitle}\nОценка стоимости: ${costEstimate}\nСрок выполнения: ${deadline}`;

  return (
    <div className="ai-response">
      {cached && (
        <div className="ai-cached-tag" title="Получено из кэша — не потратило API">
          из кэша
        </div>
      )}

      <div className="ai-response-text">{responseText}</div>

      {(kworkTitle || costEstimate || deadline) && (
        <div className="ai-metadata">
          {kworkTitle && (
            <div className="ai-meta-item">
              <strong>Название кворка:</strong> {kworkTitle}
              <button className="btn-copy-mini" onClick={() => copyTo('title', kworkTitle)} title="Скопировать">⧉</button>
            </div>
          )}
          {costEstimate && (
            <div className="ai-meta-item">
              <strong>Стоимость:</strong> {costEstimate}
              <button className="btn-copy-mini" onClick={() => copyTo('cost', costEstimate)} title="Скопировать">⧉</button>
            </div>
          )}
          {deadline && (
            <div className="ai-meta-item">
              <strong>Срок:</strong> {deadline}
              <button className="btn-copy-mini" onClick={() => copyTo('deadline', deadline)} title="Скопировать">⧉</button>
            </div>
          )}
        </div>
      )}

      <div className="ai-actions">
        <button className="btn btn-copy" onClick={() => copyTo('text', responseText)}>
          {copied === 'text' ? 'Скопировано!' : 'Копировать отклик'}
        </button>
        <button className="btn btn-copy-all" onClick={() => copyTo('all', fullText)}>
          {copied === 'all' ? 'Скопировано!' : 'Копировать всё'}
        </button>
        {onDelete && (
          <button className="btn btn-copy-all" onClick={onDelete} title="Удалить кэш отклика">
            Удалить
          </button>
        )}
      </div>
    </div>
  );
}
