"use client";
import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "@/lib/theme";

type Theme = "light" | "dark";

/**
 * Swaps the theme in one step behind a snapshot of the page, then uncovers the
 * new colours in a circle growing out of the button. Only the snapshot moves,
 * so it stays smooth however long the page is. Browsers without view
 * transitions, and anyone who asks for reduced motion, get an instant switch.
 */
function apply(t: Theme, from?: HTMLElement) {
  const root = document.documentElement;
  const swap = () => { root.dataset.theme = t; };
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return swap();
  const transition = document.startViewTransition(swap);
  if (!from) return;
  const box = from.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add("theme-wipe");
  transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  }).catch(() => {});
  transition.finished.finally(() => root.classList.remove("theme-wipe"));
}

/** Sun and moon button in the top bar. Follows the device until someone picks. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const media = matchMedia("(prefers-color-scheme: dark)");
    const follow = (e: MediaQueryListEvent) => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch {}
      if (saved) return;
      const t = e.matches ? "dark" : "light";
      apply(t);
      setTheme(t);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="gnav-icon theme-toggle" type="button" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      onClick={(e) => {
        apply(next, e.currentTarget);
        setTheme(next);
        try { localStorage.setItem(KEY, next); } catch {}
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <mask id="theme-moon">
          <rect width="24" height="24" fill="#fff" />
          <circle className="theme-bite" cx="24" cy="4" r="7" fill="#000" />
        </mask>
        <circle className="theme-core" cx="12" cy="12" r="5" fill="currentColor" mask="url(#theme-moon)" />
        <g className="theme-rays" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4 6 18M18 6l1.4-1.4" />
        </g>
      </svg>
    </button>
  );
}
