/** Shown the moment a link is clicked, while the next page is put together on the server. */
export default function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <div className="loading-bar" />
      <div className="skeleton sk-eyebrow" />
      <div className="skeleton sk-title" />
      <div className="skeleton sk-line" />
      <div className="sk-rows">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton sk-row" />)}
      </div>
    </div>
  );
}
