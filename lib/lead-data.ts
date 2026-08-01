export type WebsiteStatus = "unknown" | "yes" | "no";

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export function normalizeLeadDetails(body: Record<string, unknown>) {
  const websiteStatus: WebsiteStatus = ["yes", "no"].includes(String(body.websiteStatus))
    ? String(body.websiteStatus) as WebsiteStatus
    : "unknown";
  const sourceImages = Array.isArray(body.images) ? body.images : [];
  return {
    facebookUrl: text(body.facebookUrl, 2_000),
    instagramUrl: text(body.instagramUrl, 2_000),
    email: text(body.email, 320),
    phone: text(body.phone, 80),
    websiteStatus,
    websiteUrl: websiteStatus === "yes" ? text(body.websiteUrl, 2_000) : "",
    notes: text(body.notes, 5_000),
    images: sourceImages.slice(0, 30).map((item: unknown) => {
      const image = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { url: text(image.url, 4_000), description: text(image.description, 500) };
    }).filter((image: { url: string; description: string }) => image.url || image.description),
  };
}

function isHttpUrl(value: string) {
  if (!value) return true;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

export function validateCompletion(details: ReturnType<typeof normalizeLeadDetails>) {
  const invalidUrl = [details.facebookUrl, details.instagramUrl, details.websiteUrl, ...details.images.filter(image => image.url).map(image => image.url)].find(value => !isHttpUrl(value));
  if (invalidUrl) return "One of the links is invalid. Use a complete http:// or https:// URL.";
  if (details.websiteStatus === "yes" && !details.websiteUrl) return "Add the website URL, or choose ‘No website found’.";
  if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) return "Enter a valid email address.";
  if (details.phone && details.phone.replace(/\D/g, "").length < 5) return "Enter a valid contact number.";
  const meaningful = details.facebookUrl || details.instagramUrl || details.email || details.phone || details.websiteStatus !== "unknown" || details.notes || details.images.some(image => image.url);
  if (!meaningful) return "Add at least one research result before marking this lead complete.";
  return null;
}
