export default function Toast({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={'toast toast-' + t.type}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
