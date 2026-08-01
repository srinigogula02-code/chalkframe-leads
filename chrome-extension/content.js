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

function submit(text) {
  const url = findMetaAdUrl(text);
  const now = Date.now();
  if (!url || (url === lastUrl && now - lastSentAt < 5000)) return;
  lastUrl = url; lastSentAt = now;
  chrome.runtime.sendMessage({ type: "ADD_AD", url });
}

document.addEventListener("copy", event => {
  submit(event.clipboardData?.getData("text/plain"));
  setTimeout(() => navigator.clipboard.readText().then(submit).catch(() => {}), 80);
}, true);

document.addEventListener("click", event => {
  const control = event.target instanceof Element ? event.target.closest("button, [role='button'], a") : null;
  const label = `${control?.textContent || ""} ${control?.getAttribute("aria-label") || ""}`;
  if (!/copy|link/i.test(label)) return;
  [100, 350, 800].forEach(delay => setTimeout(() => navigator.clipboard.readText().then(submit).catch(() => {}), delay));
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
