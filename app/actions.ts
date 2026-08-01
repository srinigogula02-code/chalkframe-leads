"use server";

import { compare } from "bcryptjs";
import { redirect } from "next/navigation";
import { clearSession, createSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function loginAction(_: { error: string | undefined }, formData: FormData): Promise<{ error: string | undefined }> {
  const username = String(formData.get("username") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const rows = await sql`SELECT id, username, name, role, password_hash FROM users WHERE username = ${username} AND active = true LIMIT 1`;
  const user = rows[0];
  if (!user || !(await compare(password, user.password_hash))) return { error: "The username or password is incorrect." };
  await createSession({ id: user.id, username: user.username, name: user.name, role: user.role });
  redirect("/dashboard");
}

export async function logoutAction() { await clearSession(); redirect("/login"); }
