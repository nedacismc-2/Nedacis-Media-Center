import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { CloudImage } from './CloudMedia';

interface WelcomeScreenProps {
  open: boolean;
  brandName: string;
  logoUrl: string;
  onComplete: () => void;
}

export function WelcomeScreen({ open, brandName, logoUrl, onComplete }: WelcomeScreenProps) {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const autoTimer = window.setTimeout(() => {
      onComplete();
    }, prefersReducedMotion ? 1400 : 2850);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        onComplete();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(autoTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onComplete, prefersReducedMotion]);

  const customBrandSubtitle =
    brandName && brandName.trim() && brandName.trim().toLowerCase() !== 'multimedia'
      ? `${brandName.trim()} · `
      : '';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="nmc-welcome-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={
            prefersReducedMotion
              ? { opacity: 0, transition: { duration: 0.2 } }
              : { opacity: 0, y: -14, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } }
          }
          role="dialog"
          aria-modal="true"
          aria-label="Selamat datang di Nedacis Media Center"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B132B] text-white overflow-hidden px-6 select-none"
        >
          {/* Subtle architectural hairline grid */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #E2E8F0 1px, transparent 1px), linear-gradient(to bottom, #E2E8F0 1px, transparent 1px)',
              backgroundSize: '64px 64px',
            }}
          />

          {/* Centered depth vignette */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 44%, rgba(30, 58, 138, 0.42) 0%, rgba(11, 19, 43, 0.92) 64%)',
            }}
          />

          {/* Perimeter editorial frame */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-4 sm:inset-7 border border-white/10 rounded-2xl"
          />

          <div className="relative z-10 flex flex-col items-center text-center max-w-xl w-full">
            {/* Animated Crest / Logo */}
            <motion.div
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex items-center justify-center w-28 h-28 sm:w-32 sm:h-32 mb-7"
            >
              {/* Animated geometric framing SVG */}
              <svg
                viewBox="0 0 128 128"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="absolute inset-0 w-full h-full"
              >
                <motion.rect
                  x="4"
                  y="4"
                  width="120"
                  height="120"
                  rx="28"
                  stroke="#FACC15"
                  strokeWidth="1.75"
                  strokeOpacity="0.85"
                  initial={prefersReducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
                />
                <motion.rect
                  x="11"
                  y="11"
                  width="106"
                  height="106"
                  rx="22"
                  stroke="#B91C1C"
                  strokeWidth="1.25"
                  strokeOpacity="0.9"
                  initial={prefersReducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.95, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                />
              </svg>

              {logoUrl ? (
                <motion.div
                  initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.55, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white/95 p-2 flex items-center justify-center shadow-lg overflow-hidden"
                >
                  <CloudImage
                    src={logoUrl}
                    alt={brandName || 'Logo Nedacis Media Center'}
                    className="w-full h-full object-contain"
                  />
                </motion.div>
              ) : (
                <svg
                  viewBox="0 0 88 88"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  className="relative w-20 h-20 sm:w-24 sm:h-24"
                >
                  <rect x="2" y="2" width="84" height="84" rx="18" fill="#1E3A8A" />
                  <motion.circle
                    cx="44"
                    cy="33"
                    r="13"
                    stroke="#FACC15"
                    strokeWidth="2.5"
                    initial={prefersReducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <motion.circle
                    cx="44"
                    cy="33"
                    r="4.5"
                    fill="#FFFFFF"
                    initial={prefersReducedMotion ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <motion.text
                    x="44"
                    y="69"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="20"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, system-ui, sans-serif"
                    letterSpacing="2.2"
                    initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  >
                    NMC
                  </motion.text>
                </svg>
              )}
            </motion.div>

            {/* Institutional Eyebrow */}
            <motion.p
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="text-xs font-medium tracking-[0.18em] uppercase text-amber-300/90"
            >
              SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi
            </motion.p>

            {/* Main Brand Headline */}
            <motion.h1
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mt-3 font-serif text-3xl sm:text-5xl font-semibold tracking-tight text-white text-balance"
            >
              Nedacis Media Center
            </motion.h1>

            {/* Hairline Accent Divider */}
            <motion.div
              aria-hidden="true"
              initial={prefersReducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.55, delay: 0.48, ease: [0.16, 1, 0.3, 1] }}
              className="mt-5 mb-4 w-24 h-px bg-[#FACC15]/80 origin-center"
            />

            {/* Editorial Subtitle */}
            <motion.p
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.52, ease: [0.16, 1, 0.3, 1] }}
              className="text-sm sm:text-base text-slate-300 max-w-md leading-relaxed"
            >
              {customBrandSubtitle}Ruang Berkarya, Dokumentasi &amp; Jurnalisme Pelajar
            </motion.p>

            {/* Progress Track & Immediate Enter CTA */}
            <motion.div
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 flex flex-col items-center gap-4 w-full"
            >
              <div
                aria-hidden="true"
                className="w-44 h-[2px] bg-white/15 rounded-full overflow-hidden"
              >
                <motion.div
                  initial={prefersReducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    duration: prefersReducedMotion ? 0.2 : 2.5,
                    delay: 0.2,
                    ease: 'linear',
                  }}
                  className="w-full h-full bg-[#FACC15] origin-left"
                />
              </div>

              <button
                type="button"
                onClick={onComplete}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl bg-[#FACC15] hover:bg-[#FDE047] text-slate-950 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B132B]"
              >
                <span>Masuk Portal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
