// The Lab inside the hosted preview: the same fixture-backed fetch as the
// subscriber page, signed in as the seeded admin, reads answered from the
// capture and writes (drafts, freezes, findings) declined with a message.
// The one backtest the capture ran is answered for any spec, so the screen
// shows a real result shape.
import { installMock, setVisitor } from "./mock.js";

installMock().then(() => {
  setVisitor(false);
  // back to the subscriber page from the Lab's own "product" links
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href === "/" || href.startsWith("/home") || href.startsWith("/board") || href.startsWith("/stock/")) {
        e.preventDefault();
        window.location.href = `./index.html#${href === "/" ? "/home" : href}`;
      }
    },
    true,
  );
  return import("../src/lab/main.jsx");
});
