const login = document.getElementById("login");
const connected = document.getElementById("connected");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("error");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

chrome.runtime.sendMessage({ type: "STATUS" }, status => {
  loading.hidden = true;
  if (status?.connected) showConnected(status.user); else login.hidden = false;
});

login.addEventListener("submit", event => {
  event.preventDefault(); errorBox.style.display = "none";
  const button = login.querySelector("button"); button.disabled = true; button.textContent = "Connecting…";
  chrome.runtime.sendMessage({ type: "LOGIN", username: usernameInput.value, password: passwordInput.value }, result => {
    button.disabled = false; button.textContent = "Connect extension";
    if (result?.ok) showConnected(result.user); else { errorBox.textContent = result?.error || "Could not connect."; errorBox.style.display = "block"; }
  });
});

document.getElementById("logout").addEventListener("click", () => chrome.runtime.sendMessage({ type: "LOGOUT" }, () => { connected.hidden = true; login.hidden = false; }));
function showConnected(user) { login.hidden = true; connected.hidden = false; document.getElementById("account").textContent = `Connected as ${user?.name || user?.username || "admin"}`; }
