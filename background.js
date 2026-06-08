// Allow the user to open the panel by clicking the extension action icon
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Enable the panel on all LinkedIn pages; clear currentProfile when leaving a profile
function updatePanelForTab(tabId, url) {
  const isLinkedIn = !!url?.includes("linkedin.com");
  chrome.sidePanel.setOptions({
    tabId,
    path: "sidebar.html",
    enabled: isLinkedIn,
  });
  if (isLinkedIn && !url.includes("linkedin.com/in/")) {
    chrome.storage.local.remove("currentProfile");
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  updatePanelForTab(tabId, tab.url);
  if (tab.url?.includes("linkedin.com/in/")) {
    chrome.sidePanel.open({ tabId });
  }
});

// SPA navigation — pushState/replaceState don't trigger tabs.onUpdated
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    updatePanelForTab(details.tabId, details.url);
    if (details.url.includes("linkedin.com/in/")) {
      chrome.sidePanel.open({ tabId: details.tabId });
    }
  },
  { url: [{ hostContains: "linkedin.com" }] },
);

// ── Anthropic API proxy (bypasses CORS) ────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GENERATE_MESSAGE") return false;

  const { payload, systemPrompt } = message;

  chrome.storage.local.get("anthropicApiKey", async ({ anthropicApiKey }) => {
    if (!anthropicApiKey) {
      sendResponse({ error: "no-api-key" });
      return;
    }

    try {
      const tools = payload.useWebSearch
        ? [{ type: "web_search_20250305", name: "web_search" }]
        : [];

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          tools,
          messages: [{ role: "user", content: payload.userMessage }],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        sendResponse({ error: error.error?.message ?? "api-error" });
        return;
      }

      const data = await response.json();
      const textBlock = data.content?.find((block) => block.type === "text");
      sendResponse({ message: textBlock?.text?.trim() ?? "" });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });

  return true; // keep message channel open for async response
});

// ── Alarms ─────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("followup|")) return;

  const [, prospectId, stepNumber] = alarm.name.split("|");
  const { prospects = {} } = await chrome.storage.local.get("prospects");
  const prospect = prospects[prospectId];
  if (!prospect) return;

  const stepIndex = parseInt(stepNumber) - 1;
  if (!prospect.steps[stepIndex]) return;

  prospect.steps[stepIndex].isDue = true;
  prospects[prospectId] = prospect;
  await chrome.storage.local.set({ prospects });

  chrome.notifications.create(`followup|${prospectId}|${stepNumber}`, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Follow-up due",
    message: `Time to send step ${stepNumber} to ${prospect.fullName}`,
  });
});
