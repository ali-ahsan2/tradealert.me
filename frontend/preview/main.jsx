import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { installMock, isVisitor, setVisitor } from "./mock.js";

// Boot order matters: the fixture-backed fetch must be in place and the
// session token set (or cleared, for the visitor view) before the app
// module runs, because it renders on import and the shell asks for /api/me
// at once.

// The preview bar: one toggle between the two viewers the layouts are built
// for. "View as visitor" makes the mock answer /api/me with 401 and drops
// the token, so the landing and the public pages render in the public
// layout; "View as subscriber" restores the seeded session.
function PreviewBar() {
  const [visitor, setV] = useState(isVisitor());
  const flip = () => {
    const next = !visitor;
    setVisitor(next);
    setV(next);
    // the hash router: the root is the landing for a visitor, Home for a member
    window.location.hash = "#/";
    window.dispatchEvent(new Event("ta:auth"));
  };
  return (
    <div className="preview-bar" role="region" aria-label="Preview controls">
      <span className="preview-bar-k">Preview</span>
      <span className="preview-bar-who">{visitor ? "Viewing as a visitor" : "Viewing as a subscriber"}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={flip}>
        {visitor ? "View as subscriber" : "View as visitor"}
      </button>
    </div>
  );
}

function mountBar() {
  const host = document.createElement("div");
  host.id = "preview-bar-root";
  document.body.appendChild(host);
  const style = document.createElement("style");
  style.textContent = `
    .preview-bar { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 200;
      display: inline-flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-radius: 999px;
      background: var(--ink, #111); color: var(--bg, #fff); font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.25); white-space: nowrap; }
    .preview-bar-k { font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 11px; opacity: .7; }
    .preview-bar .btn { min-height: 32px; }
    @media (max-width: 899px) { .layout-app .preview-bar { bottom: calc(72px + env(safe-area-inset-bottom)); } }
  `;
  document.head.appendChild(style);
  createRoot(host).render(<PreviewBar />);
}

installMock().then(() => import("../src/main.jsx")).then(mountBar);
