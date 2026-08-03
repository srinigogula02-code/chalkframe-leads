export type MetaAdLink = { adId: string; canonicalUrl: string };

export function parseMetaAdLibraryUrl(value: unknown): MetaAdLink | null {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!["facebook.com", "www.facebook.com", "m.facebook.com"].includes(hostname) || !parsed.pathname.startsWith("/ads/library")) return null;
  const adId = parsed.searchParams.get("id")?.trim() ?? "";
  if (!/^\d{1,32}$/.test(adId)) return null;
  return { adId, canonicalUrl: `https://www.facebook.com/ads/library/?id=${adId}` };
}
