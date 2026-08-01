import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return <main className="login-shell"><section className="login-brand"><img src="/brand/chalkframe-logo-dark.svg" alt="Chalkframe" /><div className="brand-message"><span className="technical">Internal workspace</span><h1>Turn ad signals into <em>working leads.</em></h1><p>A focused research queue for the Chalkframe team.</p></div><div className="frame-art" aria-hidden="true"><div /><span /></div></section><section className="login-panel"><LoginForm /><p className="privacy-note">Private system · Access is restricted</p></section></main>;
}
