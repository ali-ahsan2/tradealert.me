import React, { useCallback, useEffect, useRef, useState } from "react";

// A coachmark sequence for Home: a bottom sheet over a soft backdrop, one
// short card per step, Next / Done and Skip. It never opens on its own
// (DESIGN_V6: the welcome card is the single first-visit message); the
// account menu's "Take the tour again" calls restartTour(), which raises a
// window event the mounted Tour listens for, and leaves a pending mark so a
// Tour that mounts a moment later (after navigating to /home) still opens.
// The "seen" mark in localStorage is kept so a later version may consult
// it; every access is guarded because storage may be blocked. Styles are
// the .tour* classes in styles/assist.css; the shell decides where it mounts.

const EVENT = "ta:tour";
const DEFAULT_KEY = "ta_tour_v1";
let pendingKey = null;

function mark(key) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* the tour will simply show again next time */
  }
}

// Clears the "seen" mark and reopens any mounted Tour with this key; a Tour
// mounted afterwards picks up the pending mark.
export function restartTour(storageKey = DEFAULT_KEY) {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* nothing stored, nothing to clear */
  }
  pendingKey = storageKey;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: storageKey }));
}

// Four steps on Home. Each body is two sentences and names what the product
// does for you, never what a price will do.
export const HOME_TOUR = [
  {
    title: "Home",
    body:
      "Home opens with what happened for you since the last run: the alerts you were sent, what moved on names you were not watching, and the dates ahead.",
  },
  {
    title: "Explore and the rating word",
    body:
      "Explore ranks every name in your industries by how well its setup fits the strategy today. The rating word is the claim: strong, elevated, neutral or weak; the number beside it is detail.",
  },
  {
    title: "A name and its Why",
    body:
      "Open any name and the first line says where it landed, in plain words. Why lists the inputs behind it and which ones had no data.",
  },
  {
    title: "Alerts: one tap",
    body:
      "Tap Alert me on a name and you are emailed when a fact prints: a dated catalyst, a borrow fee that doubled, volume at three times normal. Every alert names the fact that fired it.",
  },
];

export default function Tour({ steps, storageKey = DEFAULT_KEY, onDone }) {
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

  // A restart asked for before this Tour mounted (the account menu on
  // another screen navigates to Home first).
  useEffect(() => {
    if (count > 0 && pendingKey === storageKey) {
      pendingKey = null;
      setI(0);
      setOpen(true);
    }
  }, [count, storageKey]);

  // restartTour() from anywhere (the help page, the account menu).
  useEffect(() => {
    const on = (e) => {
      if (e.detail && e.detail !== storageKey) return;
      pendingKey = null;
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
