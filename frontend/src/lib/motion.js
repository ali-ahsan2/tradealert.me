import { useEffect, useRef, useState } from "react";

// Motion that earns its place: a section rises 8px and fades in the first
// time it scrolls into view; a counter settles onto its number once. Both
// respect prefers-reduced-motion, and both are no-ops without
// IntersectionObserver (old WebKit, print).

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// <section ref={ref} className={`reveal ${seen ? "in" : ""}`}>
export function useReveal({ once = true, rootMargin = "0px 0px -10% 0px" } = {}) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(() => prefersReducedMotion());
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || typeof IntersectionObserver === "undefined") {
      if (el && !seen) setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            if (once) io.disconnect();
          } else if (!once) setSeen(false);
        }
      },
      { rootMargin, threshold: 0.12 }
    );
    io.observe(el);
    // never leave content hidden: if the observer has not fired within a
    // moment (print, a scroll container it cannot see, a stalled frame),
    // show it anyway
    const safety = setTimeout(() => setSeen(true), 1500);
    return () => {
      io.disconnect();
      clearTimeout(safety);
    };
  }, [once, rootMargin, seen]);
  return [ref, seen];
}

// const n = useCountUp(1234, { active: seen, duration: 900 }) → 0 … 1234
export function useCountUp(target, { active = true, duration = 900, decimals = 0 } = {}) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(0);
  useEffect(() => {
    if (target == null || Number.isNaN(Number(target))) return undefined;
    if (!active) return undefined;
    if (prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const base = from.current;
    let raf = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = base + (Number(target) - base) * eased;
      setValue(decimals ? Number(v.toFixed(decimals)) : Math.round(v));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = Number(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration, decimals]);
  return value;
}
