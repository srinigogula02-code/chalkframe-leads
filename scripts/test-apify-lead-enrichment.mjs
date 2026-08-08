#!/usr/bin/env node

const ADS_ACTOR_ID = "JJghSZmShuco4j9gJ";
const PAGE_ACTOR_ID = "4Hv5RhChiaDk6iwad";
const API_BASE = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 5 * 60_000;

function usage() {
  console.error("Usage: APIFY_API_TOKEN=... npm run test:apify -- '<Meta Ad Library URL>'");
}

function requireMetaAdLibraryUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The input must be a valid URL.");
  }
  if (!/(^|\.)facebook\.com$/i.test(url.hostname) || !url.pathname.startsWith("/ads/library")) {
    throw new Error("The input must be a Facebook Meta Ad Library URL.");
  }
  return url.toString();
}

async function apify(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Apify request failed: ${message}`);
  }
  return body;
}

async function runActor(actorId, input, token) {
  const started = await apify(`/acts/${actorId}/runs`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const runId = started?.data?.id;
  if (!runId) throw new Error(`Actor ${actorId} did not return a run ID.`);

  const deadline = Date.now() + MAX_WAIT_MS;
  let run = started.data;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    if (Date.now() >= deadline) throw new Error(`Actor ${actorId} did not finish within five minutes (run ${runId}).`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    run = (await apify(`/actor-runs/${runId}`, token)).data;
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Actor ${actorId} ended with status ${run.status} (run ${runId}).`);
  }

  const datasetId = run.defaultDatasetId;
  const items = await apify(`/datasets/${datasetId}/items?clean=true&format=json`, token);
  return { runId, datasetId, items: Array.isArray(items) ? items : [] };
}

function candidateFacebookUrls(item) {
  return [
    item?.snapshot?.pageProfileUri,
    item?.ad_details?.advertiser?.ad_library_page_info?.page_info?.page_profile_uri,
    item?.pageInfo?.page?.url,
  ];
}

function normalizeFacebookPageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/" || path.startsWith("/ads/library")) return null;
    return `https://www.facebook.com${path}`;
  } catch {
    return null;
  }
}

function findFacebookPageUrl(items) {
  for (const item of items) {
    for (const candidate of candidateFacebookUrls(item)) {
      const normalized = normalizeFacebookPageUrl(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

function firstUsefulWebsite(item) {
  const candidates = [item?.website, ...(Array.isArray(item?.websites) ? item.websites : [])];
  for (const candidate of candidates) {
    if (!candidate || /maps\.google\./i.test(candidate)) continue;
    const value = String(candidate).trim();
    if (!value) continue;
    try {
      return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString();
    } catch {
      // Ignore malformed website candidates.
    }
  }
  return null;
}

function normalizedReport(adRun, pageRun, facebookUrl) {
  const page = pageRun.items[0] || {};
  const websiteUrl = firstUsefulWebsite(page);
  const contactFieldsFound = [page.email, page.phone, websiteUrl, page.address].filter(Boolean).length;
  return {
    success: true,
    pipeline: {
      adsActorRunId: adRun.runId,
      adsReturned: adRun.items.length,
      pageActorRunId: pageRun.runId,
      pagesReturned: pageRun.items.length,
    },
    dashboardFields: {
      title: page.title || page.pageName || adRun.items[0]?.pageName || null,
      facebookUrl,
      email: page.email || null,
      phone: page.phone || null,
      websiteStatus: websiteUrl ? "yes" : "unknown",
      websiteUrl,
    },
    additionalFields: {
      address: page.address || null,
      intro: page.intro || null,
      categories: Array.isArray(page.categories) ? page.categories : [],
      followers: page.followers ?? null,
      likes: page.likes ?? null,
      messenger: page.messenger || null,
      creationDate: page.creation_date || null,
    },
    quality: {
      facebookPageResolved: true,
      pageRecordReturned: pageRun.items.length > 0,
      contactFieldsFound,
      note: contactFieldsFound
        ? `${contactFieldsFound} contact field(s) found; Facebook pages do not always publish every field.`
        : "The page was resolved, but it does not publicly expose email, phone, website, or address fields.",
    },
  };
}

async function main() {
  const token = process.env.APIFY_API_TOKEN?.trim();
  const inputUrl = process.argv[2];
  if (!token || !inputUrl) {
    usage();
    process.exitCode = 2;
    return;
  }

  const adLibraryUrl = requireMetaAdLibraryUrl(inputUrl);
  console.error("1/2 Running Meta Ad Library actor...");
  const adRun = await runActor(ADS_ACTOR_ID, {
    startUrls: [{ url: adLibraryUrl }],
    resultsLimit: 3,
    onlyTotal: false,
    includeAboutPage: false,
    isDetailsPerAd: false,
    enrichWithEcommerceData: false,
  }, token);

  const facebookUrl = findFacebookPageUrl(adRun.items);
  if (!facebookUrl) {
    throw new Error(`Actor 1 returned ${adRun.items.length} item(s), but none contained a usable Facebook page URL.`);
  }

  console.error(`Resolved Facebook page: ${facebookUrl}`);
  console.error("2/2 Running Facebook page details actor...");
  const pageRun = await runActor(PAGE_ACTOR_ID, { startUrls: [{ url: facebookUrl }] }, token);
  if (!pageRun.items.length) throw new Error("Actor 2 completed but returned no page records.");

  console.log(JSON.stringify(normalizedReport(adRun, pageRun, facebookUrl), null, 2));
}

main().catch((error) => {
  console.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
