let lastUrl = "";
let lastSentAt = 0;

function findMetaAdUrl(text) {
  const match = String(text || "").match(/https?:\/\/(?:www\.)?facebook\.com\/ads\/library\/?[^\s]*/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return url.searchParams.has("id") ? url.toString() : null;
  } catch { return null; }
}

function cleanBusinessName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name || name.length < 2 || name.length > 160) return null;
  if (/^(?:meta ad library|ad library|sponsored|active|inactive|see ad details|view details|facebook)$/i.test(name)) return null;
  return name;
}

function findBusinessName(source) {
  let root = source instanceof Element ? source : null;
  const roots = [];
  for (let depth = 0; root && depth < 10; depth += 1, root = root.parentElement) roots.push(root);
  roots.push(document.body);
  const selectors = [
    'a[href*="view_all_page_id"]',
    'a[href*="facebook.com/"]:not([href*="/ads/library"])',
    '[role="heading"]',
    'strong',
  ];
  for (const candidateRoot of roots) {
    for (const selector of selectors) {
      const matches = candidateRoot.matches?.(selector) ? [candidateRoot] : [];
      for (const element of [...matches, ...candidateRoot.querySelectorAll(selector)]) {
        const name = cleanBusinessName(element.textContent);
        if (name) return name;
      }
    }
  }
  return null;
}

function submit(text, source) {
  const url = findMetaAdUrl(text);
  const now = Date.now();
  if (!url || (url === lastUrl && now - lastSentAt < 5000)) return;
  lastUrl = url; lastSentAt = now;
  chrome.runtime.sendMessage({ type: "ADD_AD", url, title: findBusinessName(source) });
}

document.addEventListener("copy", event => {
  const source = event.target;
  submit(event.clipboardData?.getData("text/plain"), source);
  setTimeout(() => navigator.clipboard.readText().then(text => submit(text, source)).catch(() => {}), 80);
}, true);

document.addEventListener("click", event => {
  const control = event.target instanceof Element ? event.target.closest("button, [role='button'], a") : null;
  const label = `${control?.textContent || ""} ${control?.getAttribute("aria-label") || ""}`;
  if (!/copy|link/i.test(label)) return;
  [100, 350, 800].forEach(delay => setTimeout(() => navigator.clipboard.readText().then(text => submit(text, control)).catch(() => {}), delay));
}, true);

chrome.runtime.onMessage.addListener(message => {
  if (message.type !== "NOTICE") return;
  document.getElementById("chalkframe-leads-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "chalkframe-leads-toast";
  toast.className = message.ok ? "ok" : "error";
  toast.textContent = message.text;
  document.documentElement.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 250); }, 3500);
});
