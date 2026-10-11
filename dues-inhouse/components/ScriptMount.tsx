"use client";
import { useEffect } from "react";

/**
 * Runs a page script once per visit, including after client-side navigation.
 * `marker` is the id of an element the script fills in; it is flagged so the
 * script never runs twice on the same page (React runs effects twice in development).
 */
export function ScriptMount({ src, marker }: { src: string; marker: string }) {
  useEffect(() => {
    const el = document.getElementById(marker);
    if (!el || el.dataset.mounted) return;
    el.dataset.mounted = "1";
    const s = document.createElement("script");
    s.src = `${src}?mount=${Date.now()}`;
    document.body.appendChild(s);
  }, [src, marker]);
  return null;
}
