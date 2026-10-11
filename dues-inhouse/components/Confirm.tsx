"use client";
import type { ReactNode } from "react";

/** A submit button that asks first. */
export function ConfirmButton({ message, children, className = "btn ghost small" }: { message: string; children: ReactNode; className?: string }) {
  return <button className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{children}</button>;
}
