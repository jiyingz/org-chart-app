import { useEffect, useRef, type ReactNode } from 'react';
import { IconArrowLeft, IconClose } from './icons';

interface Props {
  onClose(): void;
  onBack?(): void;
  title?: ReactNode;
  kicker?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'normal' | 'wide';
  /** Only the topmost modal reacts to Escape. */
  isTop: boolean;
}

/** Centered pop-up. Clicking the dimmed area outside it (or pressing Esc) closes it. */
export function Modal({ onClose, onBack, title, kicker, children, footer, size = 'normal', isTop }: Props) {
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    if (!isTop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop, onClose]);

  return (
    <div
      className="backdrop"
      // Only close when the press both started and ended on the backdrop, so selecting text
      // inside the modal and releasing outside doesn't dismiss it.
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size === 'normal' ? '' : size}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {onBack && (
            <button className="icon-btn" onClick={onBack} aria-label="Back">
              <IconArrowLeft />
            </button>
          )}
          <div className="titles">
            {kicker}
            {typeof title === 'string' ? <h2>{title}</h2> : title}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
