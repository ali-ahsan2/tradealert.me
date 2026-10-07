import React, { useEffect, useRef, useState } from "react";
import { Link } from "../lib/router.jsx";
import { age, shortDate } from "../lib/fmt.js";

// Small shared primitives. Each one exists because a screen spec names a
// state (loading, empty, error, locked) and every screen should render it
// the same way.

export function Skeleton({ rows = 6, height = 44, className = "" }) {
  return (
    <div className={`sk ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row" style={{ height }} />
      ))}
    </div>
  );
}

export function ErrorCard({ error, onRetry, title = "Couldn't load this." }) {
  const msg = typeof error === "string" ? error : error && error.detail;
  return (
    <div className="card state-card" role="alert">
      <p className="state-title">{title}</p>
      {msg && <p className="muted">{msg}</p>}
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="card state-card">
      <p className="state-title">{title}</p>
      {children && <div className="muted">{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children, onDismiss, className = "" }) {
  return (
    <div className={`notice notice-${tone} ${className}`} role={tone === "neg" ? "alert" : "status"}>
      <div className="notice-body">{children}</div>
      {onDismiss && (
        <button className="btn-quiet" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Monogram({ children, size = 24 }) {
  return (
    <span className="monogram" style={{ width: size, height: size }} aria-hidden="true">
      {children}
    </span>
  );
}

// Evidence status is the primary differentiator between strategies.
export function StatusChip({ calibrated, short = false }) {
  return calibrated ? (
    <span className="chip chip-cal">Calibrated</span>
  ) : (
    <span className="chip chip-prov" title="Weights not yet backed by resolved outcomes">
      {short ? "Provisional" : "Provisional — uncalibrated"}
    </span>
  );
}

export function AgeChip({ asOf, prefix = "" }) {
  const a = age(asOf);
  if (!a) return null;
  return (
    <span className={`agechip ${a.cls}`} title={`as of ${shortDate(asOf)}`}>
      {prefix}
      {a.label}
    </span>
  );
}

export function Meter({ used, limit, label }) {
  const unlimited = limit == null || limit >= 999;
  const pct = unlimited ? 0 : Math.min(100, Math.round(((used || 0) / Math.max(1, limit)) * 100));
  return (
    <div className="meter">
      <div className="meter-row">
        <span>{label}</span>
        <span className="mono">
          {unlimited ? `${used ?? 0} · unlimited` : `${used ?? 0} of ${limit}`}
        </span>
      </div>
      {!unlimited && (
        <div className="meter-track" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function TierChip({ tier, link = true }) {
  if (!tier) return null;
  const label = tier.label || tier.key || "Free";
  const upgradeable = tier.key === "free" || tier.key === "basic";
  const cls = "tierchip mono";
  return link && upgradeable ? (
    <Link to="/pricing" className={cls} title="See plans">
      {label.toUpperCase()}
    </Link>
  ) : (
    <span className={cls}>{label.toUpperCase()}</span>
  );
}

// The quota modal is the one modal in the product: it appears when an action
// the subscriber initiated cannot complete, and offers a way out that does
// not involve payment.
export function Modal({ title, onClose, children, actions }) {
  const box = useRef(null);
  const opener = useRef(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const el = box.current;
    const focusables = () =>
      Array.from(
        el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((n) => !n.disabled);
    const first = focusables()[0];
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0 || i === -1)) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (opener.current && opener.current.focus) opener.current.focus();
    };
  }, [onClose]);
  return (
    // Clicks must not bubble past the modal: a Pin inside a clickable board
    // row would otherwise navigate when the subscriber taps "See plans".
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={box}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title" className="modal-title">
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          {actions}
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let t;
    const onToast = (e) => {
      setMsg(typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail));
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 4500);
    };
    window.addEventListener("toast", onToast);
    return () => {
      window.removeEventListener("toast", onToast);
      clearTimeout(t);
    };
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {msg && (
        <button className="toast" onClick={() => setMsg(null)}>
          {msg}
        </button>
      )}
    </div>
  );
}

export function Help({ text }) {
  return (
    <span className="thinfo" title={text} aria-label={text} tabIndex={0}>
      ?
    </span>
  );
}
