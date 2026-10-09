import React, { useCallback, useEffect, useRef, useState } from "react";

// A coachmark sequence for a newcomer's first visit: a bottom sheet over a
// soft backdrop, one short card per step, Next / Done and Skip. It shows
// once per browser (localStorage, which may be blocked, so every access is
// guarded) and can be brought back with restartTour(), which clears the
// mark and raises a window event the mounted Tour listens for. Styles are
// the .tour* classes in styles/assist.css; nothing here is mounted on its
// own, the shell decides where.

const EVENT = "ta:tour";
const DEFAULT_KEY = "ta_tour_v1";

function seen(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function mark(key) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* the tour will simply show again next time */
  }
}

// Clears the "seen" mark and reopens any mounted Tour with this key.
export function restartTour(storageKey = DEFAULT_KEY) {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* nothing stored, nothing to clear */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: storageKey }));
}

// Four steps for a newcomer on Home. Each body is two sentences and names
// what the product does, never what a price will do.
export const HOME_TOUR = [
  {
    title: "Your brief",
    body:
      "Home opens with what changed on your names since the last run and why. The alerts that fired and the dated events ahead sit right under it.",
  },
  {
    title: "The Board and what a band means",
    body:
      "The Board ranks every name in your industries by how well its setup fits the strategy today. The band word is the claim: strong, elevated, neutral, weak or excluded; the number beside it is detail.",
  },
  {
    title: "A name's verdict and Why",
    body:
      "Open any name and the first line says what its score is and where it landed, in plain words. The Why section lists the inputs behind the number and which ones had no data.",
  },
  {
    title: "Alerts: one tap",
    body:
      "Tap Notify me on a name and we email you when a fact prints: a dated catalyst, a borrow fee that doubled, volume at three times normal. Every alert names the fact that fired it.",
  },
];

export default function Tour({ steps, storageKey = DEFAULT_KEY, enabled = true, onDone }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [offset, setOffset] = useState(0);
  const nextBtn = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const count = steps ? steps.length : 0;

  // Stable, so an inline onDone from the parent never re-runs the open
  // effect (and re-grabs focus) on every render.
  const finish = useCallback(() => {
    mark(storageKey);
    setOpen(false);
    if (doneRef.current) doneRef.current();
  }, [storageKey]);

  // First visit: open once, unless this browser has already seen it.
  useEffect(() => {
    if (enabled && count > 0 && !seen(storageKey)) {
      setI(0);
      setOpen(true);
    }
  }, [enabled, count, storageKey]);

  // restartTour() from anywhere (the help page, the account menu).
  useEffect(() => {
    const on = (e) => {
      if (e.detail && e.detail !== storageKey) return;
      setI(0);
      setOpen(true);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [storageKey]);

  // While open: sit above the phone tab bar, trap Escape, hold the page.
  useEffect(() => {
    if (!open) return undefined;
    const bar = document.querySelector(".bottombar");
    setOffset(bar ? bar.offsetHeight : 0);
    const key = (e) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (nextBtn.current) nextBtn.current.focus();
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [open, finish]);

  if (!open || count === 0) return null;
  const idx = Math.min(i, count - 1);
  const s = steps[idx];
  const last = idx === count - 1;

  return (
    <>
      <div className="tour-backdrop" onClick={finish} aria-hidden="true" />
      <div
        className="tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={offset ? { bottom: `calc(${offset}px + 16px)` } : undefined}
      >
        <h3 id="tour-title">{s.title}</h3>
        <p id="tour-body">{s.body}</p>
        <div className="tour-foot">
          <span className="tour-steps" role="img" aria-label={`Step ${idx + 1} of ${count}`}>
            {steps.map((_, k) => (
              <i key={k} className={k === idx ? "on" : ""} />
            ))}
          </span>
          <button type="button" className="btn-quiet" style={{ minHeight: 40 }} onClick={finish}>
            Skip tour
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 40 }}
            ref={nextBtn}
            onClick={last ? finish : () => setI(idx + 1)}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
