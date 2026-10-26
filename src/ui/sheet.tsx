import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { springs } from '../lib/motion';
import { haptic } from '../lib/haptics';
import { Icon } from './kit';

export function useFocusTrap(ref: React.RefObject<HTMLDivElement | null>, active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const sel = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const t = setTimeout(() => (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(sel))?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); el.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [active, ref]);
}

/** Bottom sheet with drag-to-dismiss from the grabber, Esc to close, and a focus trap. */
export function Sheet({ open, onClose, title, children, action }: { open: boolean; onClose: () => void; title: string; children: ReactNode; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  useFocusTrap(ref, open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" className="backdrop" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div
            key="sh"
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="sheet"
            style={{ x: '-50%' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springs.sheet}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, i) => { if (i.offset.y > 110 || i.velocity.y > 500) { haptic('light'); onClose(); } }}
          >
            <div className="sheet-grab" onPointerDown={(e) => controls.start(e)} aria-hidden="true"><i /></div>
            <div className="sheet-head">
              <h2 className="t-title3" style={{ paddingLeft: 4 }}>{title}</h2>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {action}
                <button type="button" className="iconbtn" aria-label="Close" onClick={() => { haptic('select'); onClose(); }}><Icon name="x" /></button>
              </span>
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
