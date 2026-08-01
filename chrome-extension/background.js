const API = "https://leads.chalkframe.com/api/extension";

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "ADD_AD") addAd(message.url, sender.tab?.id).then(respond);
  if (message.type === "STATUS") getStatus().then(respond);
  if (message.type === "LOGIN") login(message.username, message.password).then(respond);
  if (message.type === "LOGOUT") chrome.storage.local.clear().then(() => respond({ ok: true }));
  return true;
});

async function login(username, password) {
  try {
    const response = await fetch(`${API}/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    const body = await response.json();
    if (!response.ok) return { ok: false, error: body.error || "Could not connect." };
    await chrome.storage.local.set({ token: body.token, user: body.user });
    return { ok: true, user: body.user };
  } catch { return { ok: false, error: "Could not reach Leads." }; }
}

async function getStatus() {
  const { token, user } = await chrome.storage.local.get(["token", "user"]);
  return { connected: Boolean(token), user };
}

async function addAd(url, tabId) {
  const { token } = await chrome.storage.local.get("token");
  if (!token) return notify(tabId, false, "Connect the extension first.");
  try {
    const response = await fetch(`${API}/leads`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ adUrl: url }) });
    const body = await response.json();
    if (response.status === 401) await chrome.storage.local.remove(["token", "user"]);
    return notify(tabId, response.ok, response.ok ? "Added to Chalkframe Leads" : body.error || "Could not add this ad.");
  } catch { return notify(tabId, false, "Could not reach Chalkframe Leads."); }
}

function notify(tabId, ok, text) {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: "NOTICE", ok, text }).catch(() => {});
  return { ok, text };
}
