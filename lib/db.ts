import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

export const sql = neon(process.env.DATABASE_URL);

export type UserRole = "admin" | "employee";
export type SessionUser = { id: string; username: string; name: string; role: UserRole };
