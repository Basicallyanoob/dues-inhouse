"use client";
import { useEffect } from "react";

/** What eases in. Keep in step with the "Scroll reveal" rules in globals.css. */
const TARGETS = "[data-reveal], main > section:not(.hero):not(.band), .tiles > .tile, .records > .record-card, .figures > div";

/**
 * Fades sections in as they scroll into view. They start hidden only once
 * this has run (html.reveal), so the page still shows everything without
 * JavaScript, and nothing moves for people who ask for reduced motion.
 * New content (another page, a streamed section) is picked up as it arrives,
 * so nothing is left hidden.
 */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const watched = new WeakSet<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    const scan = () => {
      for (const el of document.querySelectorAll(TARGETS)) {
        if (watched.has(el) || el.classList.contains("is-in")) continue;
        watched.add(el);
        io.observe(el);
      }
    };
    scan();
    document.documentElement.classList.add("reveal");
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);
  return null;
}
