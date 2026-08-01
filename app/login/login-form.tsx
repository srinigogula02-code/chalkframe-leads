"use client";
import { useActionState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { loginAction } from "@/app/actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: undefined });
  return <div className="login-card"><div className="login-icon"><LockKeyhole size={20} /></div><span className="technical">Team access</span><h2>Welcome back</h2><p>Use the credentials provided by your administrator.</p><form action={action}><label>Username<input name="username" autoComplete="username" required placeholder="Your username" /></label><label>Password<input name="password" type="password" autoComplete="current-password" required placeholder="Your password" /></label>{state.error && <div className="form-error">{state.error}</div>}<button className="primary-button" disabled={pending}>{pending ? "Signing in…" : "Sign in"}<ArrowRight size={17} /></button></form><div className="session-copy"><span>7</span><p><strong>days remembered</strong>Your secure session stays active on this device.</p></div></div>;
}
