export default function NoticeModal({ notice, onClose }) {
  if (!notice) {
    return null;
  }

  return (
    <div className="detail-overlay">
      <section className="detail-modal notice-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Success</p>
            <h2>{notice.title}</h2>
          </div>
          <button type="button" className="secondary-btn" onClick={onClose}>Close</button>
        </div>
        <div className="detail-card">
          <p>{notice.message}</p>
        </div>
      </section>
    </div>
  );
}
