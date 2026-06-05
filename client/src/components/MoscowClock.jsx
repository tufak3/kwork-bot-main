import { useState, useEffect } from 'react';

function getMoscowTime() {
  // Moscow is UTC+3
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const moscow = new Date(utc + 3 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(moscow.getHours())}:${pad(moscow.getMinutes())}:${pad(moscow.getSeconds())}`;
}

export default function MoscowClock() {
  const [time, setTime] = useState(getMoscowTime());

  useEffect(() => {
    const id = setInterval(() => setTime(getMoscowTime()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="moscow-clock" title="Московское время (UTC+3)">
      <span className="clock-icon">🕐</span>
      <span className="clock-time">{time}</span>
      <span className="clock-label">МСК</span>
    </div>
  );
}
