import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./db";

const COOKIE = "chalkframe_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "development-only-secret-change-me");
const extensionSecret = new TextEncoder().encode(process.env.EXTENSION_SECRET || process.env.SESSION_SECRET || "development-only-secret-change-me");

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { id: String(payload.id), username: String(payload.username), name: String(payload.name), role: payload.role as SessionUser["role"] };
  } catch { return null; }
}

export async function clearSession() { (await cookies()).delete(COOKIE); }

export async function createExtensionToken(user: SessionUser) {
  return new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setAudience("chalkframe-extension").setIssuedAt().setExpirationTime("30d").sign(extensionSecret);
}

export async function verifyExtensionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, extensionSecret, { audience: "chalkframe-extension" });
    return { id: String(payload.id), username: String(payload.username), name: String(payload.name), role: payload.role as SessionUser["role"] };
  } catch { return null; }
}
