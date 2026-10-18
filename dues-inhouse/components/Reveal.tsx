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
    // A page streams in behind the loading screen and hydrates a moment later. Marking it before
    // then is a hydration mismatch, so wait until React has claimed the element (it tags each one
    // it hydrates). Until then the html.reveal rule keeps it hidden, so the wait isn't visible.
    const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
    let tries = 0;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    let frame = 0;
    // Typing in the team builder or sorting a table changes the page many times a second; look once per frame at most.
    const later = () => { frame ||= requestAnimationFrame(() => { frame = 0; scan(); }); };
    const scan = () => {
      let waiting = false;
      for (const el of document.querySelectorAll(TARGETS)) {
        if (watched.has(el) || el.classList.contains("is-in")) continue;
        if (!hydrated(el) && tries < 300) { waiting = true; continue; }
        watched.add(el);
        io.observe(el);
      }
      tries = waiting ? tries + 1 : 0;
      if (waiting) later();
    };
    scan();
    document.documentElement.classList.add("reveal");
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      io.disconnect();
    };
  }, []);
  return null;
}
