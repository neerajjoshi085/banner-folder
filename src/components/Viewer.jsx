import { useEffect, useRef } from 'react';

export function Viewer({ item, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    else if (!item && dialog.open) dialog.close();
  }, [item]);

  return (
    <dialog
      ref={dialogRef}
      className="viewer"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {item && (
        <div className="viewer-body">
          <div className="viewer-image">
            <img className={item.checker ? 'is-checker' : undefined} src={item.src} alt={item.alt} />
          </div>
          <div className="viewer-info">
            <h2 className="viewer-title">{item.path.split('/').pop()}</h2>
            <p>{item.alt}</p>
            <dl className="facts">
              {item.facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="viewer-actions">
              <button type="button" className="button button-quiet" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
