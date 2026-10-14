import { REPO, logError } from "./shared/errors.js";

const FEED = `https://raw.githubusercontent.com/${REPO}/main/updates/latest.json`;
const VERSION = chrome.runtime.getManifest().version;

// The toolbar badge shows how many listings are hidden on the current tab.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  if (msg.type === "count" && tabId != null) {
    const text = msg.n > 0 ? String(msg.n > 999 ? "999+" : msg.n) : "";
    chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#5b5b5b" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: msg.n ? `Marketplace Lens: ${msg.n} listing${msg.n === 1 ? "" : "s"} you've already seen are hidden` : "Marketplace Lens" }).catch(() => {});
    chrome.storage.session.set({ [`count:${tabId}`]: msg.n }).catch(() => {});
  } else if (msg.type === "error") {
    logError(msg.code, msg.details);
  } else if (msg.type === "checkUpdates") {
    checkForUpdates(true).then(reply);
    return true;
  }
});

// ---------- updates ----------
// Unpacked extensions can't replace their own files, so this only tells you
// a newer version exists; the popup shows how to install it.

function newer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkForUpdates(manual = false) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const feed = settings.updateSource || FEED;
  let state;
  try {
    let res;
    try {
      res = await fetch(feed, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      throw Object.assign(new Error(`${feed}: ${e.message}`), { code: "ML-101" });
    }
    let latest;
    try {
      latest = await res.json();
      if (!latest.version) throw new Error("no version field");
    } catch (e) {
      throw Object.assign(new Error(`${feed}: ${e.message}`), { code: "ML-102" });
    }
    state = {
      checkedAt: Date.now(),
      current: VERSION,
      latest: latest.version,
      available: newer(latest.version, VERSION),
      notes: latest.notes || "",
      url: latest.url ? new URL(latest.url, feed).toString() : null,
    };
  } catch (e) {
    state = { checkedAt: Date.now(), current: VERSION, available: false, error: { code: e.code || "ML-999", details: e.message } };
    if (manual) await logError(state.error.code, state.error.details);
  }
  await chrome.storage.local.set({ update: state });
  return state;
}

chrome.alarms.create("updates", { periodInMinutes: 6 * 60 });
chrome.alarms.onAlarm.addListener((a) => a.name === "updates" && checkForUpdates());
chrome.runtime.onStartup.addListener(() => setTimeout(checkForUpdates, 5000));
chrome.runtime.onInstalled.addListener(() => setTimeout(checkForUpdates, 5000));
