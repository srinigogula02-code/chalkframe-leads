import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-crypto";

const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

async function validateToken(token: string) {
  const response = await fetch("https://api.apify.com/v2/users/me", {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "Apify rejected this API key.");
  return body?.data?.username || body?.data?.email || "Apify account";
}

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await sql`SELECT auto_enrich_on_add, monthly_budget_usd, max_ads_per_business, api_token_hint, api_token_ciphertext IS NOT NULL AS api_key_configured, updated_at FROM apify_enrichment_settings WHERE id=1`;
  if (!rows[0]) return NextResponse.json({ error: "Apify settings are not initialized." }, { status: 404 });
  return NextResponse.json({ settings: rows[0] });
}

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const monthlyBudgetUsd = finite(body.monthlyBudgetUsd);
  const maxAdsPerBusiness = finite(body.maxAdsPerBusiness);
  if (monthlyBudgetUsd === null || monthlyBudgetUsd <= 0 || monthlyBudgetUsd > 1_000) {
    return NextResponse.json({ error: "The Apify budget must be between $0.01 and $1,000." }, { status: 400 });
  }
  if (maxAdsPerBusiness === null || !Number.isInteger(maxAdsPerBusiness) || maxAdsPerBusiness < 1 || maxAdsPerBusiness > 100) {
    return NextResponse.json({ error: "Ads per business must be a whole number between 1 and 100." }, { status: 400 });
  }

  const suppliedToken = String(body.apiToken ?? "").trim();
  let account: string | null = null;
  let encrypted: string | null = null;
  let hint: string | null = null;
  if (suppliedToken) {
    if (!suppliedToken.startsWith("apify_api_") || suppliedToken.length < 24) {
      return NextResponse.json({ error: "Enter a complete Apify API key." }, { status: 400 });
    }
    try { account = await validateToken(suppliedToken); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Apify rejected this API key." }, { status: 400 }); }
    encrypted = encryptSecret(suppliedToken);
    hint = suppliedToken.slice(-4);
  }

  const rows = suppliedToken
    ? await sql`UPDATE apify_enrichment_settings SET api_token_ciphertext=${encrypted}, api_token_hint=${hint}, token_version=gen_random_uuid(),
        auto_enrich_on_add=${Boolean(body.autoEnrichOnAdd)}, monthly_budget_usd=${monthlyBudgetUsd}, max_ads_per_business=${maxAdsPerBusiness},
        updated_by=${user.id}, updated_at=now() WHERE id=1
        RETURNING auto_enrich_on_add, monthly_budget_usd, max_ads_per_business, api_token_hint, true AS api_key_configured, updated_at`
    : await sql`UPDATE apify_enrichment_settings SET auto_enrich_on_add=${Boolean(body.autoEnrichOnAdd)},
        monthly_budget_usd=${monthlyBudgetUsd}, max_ads_per_business=${maxAdsPerBusiness}, updated_by=${user.id}, updated_at=now()
        WHERE id=1 RETURNING auto_enrich_on_add, monthly_budget_usd, max_ads_per_business, api_token_hint,
        api_token_ciphertext IS NOT NULL AS api_key_configured, updated_at`;
  return NextResponse.json({ saved: true, account, settings: rows[0] });
}
