"use client";

import Link from "next/link";
import { BarChart3, CheckCircle2, LayoutGrid, LogOut, Menu, Palette, Users } from "lucide-react";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/db";

type Section = "leads" | "research" | "redesign" | "stats";

export default function DashboardSidebar({ user, active }: { user: SessionUser; active: Section }) {
  const navigation = <><Link className={`nav-item ${active === "leads" ? "active" : ""}`} href="/dashboard"><LayoutGrid size={18}/>Leads</Link>{user.role === "admin"&&<><Link className={`nav-item ${active === "research" ? "active" : ""}`} href="/dashboard/research-completed"><CheckCircle2 size={18}/>Research completed</Link><Link className={`nav-item ${active === "redesign" ? "active" : ""}`} href="/dashboard/redesign-created"><Palette size={18}/>Redesign created</Link><Link className={`nav-item ${active === "stats" ? "active" : ""}`} href="/dashboard/stats"><BarChart3 size={18}/>Stats</Link><Link className="nav-item" href="/dashboard#team"><Users size={18}/>Team earnings</Link></>}</>;
  return <aside className="sidebar"><img src="/brand/chalkframe-logo-dark.svg" alt="Chalkframe" className="side-logo"/><nav className="desktop-nav">{navigation}</nav><details className="mobile-nav"><summary aria-label="Open sidebar navigation"><Menu size={19}/><span>Menu</span></summary><nav>{navigation}</nav></details><div className="side-bottom"><div className="user-chip"><span>{user.name.charAt(0)}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div><form action={logoutAction}><button className="logout" aria-label="Sign out"><LogOut size={17}/></button></form></div></aside>;
}
