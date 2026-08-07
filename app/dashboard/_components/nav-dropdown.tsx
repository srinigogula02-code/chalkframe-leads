"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { BarChart3, Bot, CheckCircle2, LayoutGrid, LogOut, Mail, Palette, Sparkles, Menu, X } from "lucide-react";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/db";

/**
 * Compact navigation dropdown for pages that don't have the main sidebar
 * (e.g. business detail page, redesign-created review page).
 */
export default function NavDropdown({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="nav-dropdown-wrap" ref={ref}>
      <button
        type="button"
        className="nav-dropdown-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <X size={16} /> : <Menu size={16} />}
        <span>Navigate</span>
      </button>

      {open && (
        <div className="nav-dropdown-panel" role="dialog" aria-label="Navigation menu">
          <nav className="nav-dropdown-links">
            <Link href="/dashboard" onClick={() => setOpen(false)}>
              <LayoutGrid size={15} /> Leads
            </Link>
            {user.role === "admin" && (
              <>
                <Link href="/dashboard/research-completed" onClick={() => setOpen(false)}>
                  <CheckCircle2 size={15} /> Research completed
                </Link>
                <Link href="/dashboard/redesign-created" onClick={() => setOpen(false)}>
                  <Palette size={15} /> Redesign created
                </Link>
                <Link href="/dashboard/ai" onClick={() => setOpen(false)}>
                  <Bot size={15} /> AI email drafts
                </Link>
                <Link href="/dashboard/ai-ad-redesigns" onClick={() => setOpen(false)}>
                  <Sparkles size={15} /> AI Ad Redesigns
                </Link>
                <Link href="/dashboard/email-template" onClick={() => setOpen(false)}>
                  <Mail size={15} /> Email Template
                </Link>
                <Link href="/dashboard/stats" onClick={() => setOpen(false)}>
                  <BarChart3 size={15} /> Stats
                </Link>
              </>
            )}
          </nav>
          <div className="nav-dropdown-user">
            <span>{user.name.charAt(0)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="nav-dropdown-logout" aria-label="Sign out">
                <LogOut size={14} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
