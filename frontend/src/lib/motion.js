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
  // The observer outlives re-renders (a number counting up re-renders its
  // section every frame) and is torn down only on unmount; the element may
  // mount after data arrives, so the effect below has no dependency list and
  // (re)targets the observer whenever the ref points somewhere new.
  const io = useRef(null);
  const watched = useRef(null);
  const heard = useRef(false);
  const safety = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || watched.current === el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    if (!io.current) {
      io.current = new IntersectionObserver(
        (entries) => {
          heard.current = true;
          for (const e of entries) {
            if (e.isIntersecting) {
              setSeen(true);
              if (once) io.current.disconnect();
            } else if (!once) setSeen(false);
          }
        },
        { rootMargin, threshold: 0 }
      );
      // never leave content hidden: an observer that has not reported at all
      // within a moment (print, a stalled frame, a scroll container it cannot
      // see) is not going to, so the section shows anyway
      safety.current = setTimeout(() => {
        if (!heard.current) setSeen(true);
      }, 1500);
    }
    if (watched.current) io.current.unobserve(watched.current);
    io.current.observe(el);
    watched.current = el;
  });
  useEffect(
    () => () => {
      if (io.current) io.current.disconnect();
      clearTimeout(safety.current);
      io.current = null;
      watched.current = null;
      heard.current = false;
    },
    []
  );
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
