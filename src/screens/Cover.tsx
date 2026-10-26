import { motion } from 'motion/react';
import { setUI } from '../domain/store';
import { haptic } from '../lib/haptics';
import { Icon } from '../ui/kit';
import { motionTokens } from '../lib/motion';

const rise = (i: number) => ({
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth, delay: 0.08 + i * 0.09 },
});

export function Cover() {
  const start = (guide: boolean) => { haptic('medium'); setUI({ screen: 'lock', guide }); };
  return (
    <main className="cover" id="main">
      <nav className="cover-nav" aria-label="Prototype">
        <motion.div className="cover-pill" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: motionTokens.easing.smooth }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="bell" size={18} weight="fill" /> Azalea e-Helpdesk</span>
          <span className="t-sub" style={{ opacity: 0.7, paddingRight: 8 }}>Interactive prototype</span>
        </motion.div>
      </nav>

      <section className="cover-hero" aria-labelledby="cover-title">
        <motion.h1 id="cover-title" className="cover-h1" {...rise(0)}>Every request has an owner. Every shift has a handover.</motion.h1>
        <motion.p className="cover-sub" {...rise(1)}>A calm service desk for hotels that keeps working when the internet, the power or the signal does not.</motion.p>
        <motion.div className="cover-cta" {...rise(2)}>
          <button type="button" className="btn btn-fill btn-lg" onClick={() => start(true)}>Start the guided demo</button>
          <button type="button" className="btn btn-gray btn-lg" onClick={() => start(false)}>Explore on your own</button>
        </motion.div>
      </section>

      <motion.div className="cover-foot" {...rise(3)}>
        <div><b>Works offline</b>Phones keep logging. The hotel network keeps sharing.</div>
        <div><b>Quiet by default</b>Sound is for safety and VIP guests, never routine requests.</div>
        <div><b>Fair to staff</b>Reports show departments, never personal rankings.</div>
      </motion.div>
      <p className="cover-note">Prototype with synthetic data. Not for operational use.</p>
    </main>
  );
}
