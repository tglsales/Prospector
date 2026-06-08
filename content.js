// ── Scraping ───────────────────────────────────────────────────

function extractName() {
  const clean = (raw) =>
    raw
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*\|\s*LinkedIn$/, "")
      .trim();
  const fromTitle = clean(document.title);
  if (fromTitle && fromTitle.toLowerCase() !== "linkedin") return fromTitle;
  const ogContent =
    document.querySelector('meta[property="og:title"]')?.content ?? "";
  const fromOg = clean(ogContent);
  if (fromOg && fromOg.toLowerCase() !== "linkedin") return fromOg;
  return document.querySelector("h1")?.textContent?.trim() ?? "";
}

function extractRole() {
  // LinkedIn headline sits right below h1 — walk up from h1 to find .text-body-medium sibling
  const h1 = document.querySelector("h1");
  if (!h1) return "";
  let container = h1.parentElement;
  for (let i = 0; i < 4; i++) {
    const headline = container?.querySelector(".text-body-medium.break-words");
    if (headline && headline !== h1 && headline.textContent.trim()) {
      return headline.textContent.trim();
    }
    container = container?.parentElement;
  }
  return "";
}

function extractCompany() {
  const companyIcon = document.querySelector('svg[id^="company-"]');
  return (
    companyIcon
      ?.closest('[role="button"]')
      ?.querySelector("p")
      ?.textContent?.trim() ?? ""
  );
}

function extractCompanyLogoUrl() {
  const companyIcon = document.querySelector('svg[id^="company-"]');
  return (
    companyIcon?.closest('[role="button"]')?.querySelector("img")?.src ?? null
  );
}

function extractPhotoUrl(fullName) {
  const byAlt = document.querySelector(`img[alt="${fullName}"]`);
  if (byAlt?.src) return byAlt.src;
  const firstName = fullName.split(" ")[0];
  if (firstName) {
    const cdn = [...document.querySelectorAll("img[alt]")].find(
      (img) => img.alt.includes(firstName) && img.src.includes("licdn.com/dms"),
    );
    if (cdn?.src) return cdn.src;
  }
  return null;
}

function scrapeProfile() {
  const pathname = window.location.pathname.replace(/\/$/, "");
  if (!pathname.startsWith("/in/")) return;

  const fullName = extractName();
  const nameParts = fullName.split(" ");

  const profile = {
    id: pathname,
    scrapedAt: Date.now(),
    fullName,
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" "),
    role: extractRole(),
    company: extractCompany(),
    companyLogoUrl: extractCompanyLogoUrl(),
    photoUrl: extractPhotoUrl(fullName),
  };

  console.log("[TGL] Scraped profile:", profile);
  chrome.storage.local.set({ currentProfile: profile });
}

// Retry once after 1.5s if photo or company are still missing (lazy-loaded by LinkedIn).
function retryIfIncomplete() {
  setTimeout(() => {
    chrome.storage.local.get("currentProfile", ({ currentProfile }) => {
      if (
        currentProfile &&
        (!currentProfile.photoUrl || !currentProfile.company)
      ) {
        scrapeProfile();
      }
    });
  }, 1500);
}

// Wait until both document.title and h1 carry the same name before scraping.
// Title alone is not enough — h1 lags slightly on SPA navigation, so checking
// both prevents scraping stale DOM from the previous profile.
function scrapeWhenReady(timeoutMs = 8000) {
  const isReady = () => {
    const titleName = document.title
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*\|\s*LinkedIn$/, "")
      .trim();
    if (!titleName || titleName.toLowerCase() === "linkedin") return false;
    const h1Text = document.querySelector("h1")?.textContent?.trim() ?? "";
    if (!h1Text) return false;
    // Both must agree on at least the first name token
    return titleName.split(" ")[0] === h1Text.split(" ")[0];
  };

  if (isReady()) {
    scrapeProfile();
    retryIfIncomplete();
    return;
  }

  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed += 250;
    if (isReady() || elapsed >= timeoutMs) {
      clearInterval(interval);
      scrapeProfile();
      retryIfIncomplete();
    }
  }, 250);
}

// ── Navigation ─────────────────────────────────────────────────

let lastPath = location.pathname.replace(/\/$/, "");

function handleNavigation() {
  const currentPath = location.pathname.replace(/\/$/, "");
  if (currentPath === lastPath) return;
  lastPath = currentPath;

  chrome.storage.local.remove("currentProfile");

  if (currentPath.startsWith("/in/")) {
    // Delay before polling — title/h1 still carry the previous profile for ~200ms after pushState
    setTimeout(() => scrapeWhenReady(), 300);
  }
}

// LinkedIn updates <title> on every SPA navigation — no need to wait for a message from background.js
const titleEl = document.querySelector("title");
if (titleEl) {
  new MutationObserver(handleNavigation).observe(titleEl, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "REFRESH_PROFILE") {
    chrome.storage.local.remove("currentProfile");
    if (location.pathname.startsWith("/in/")) {
      scrapeWhenReady();
    }
  }
});

// ── Init ───────────────────────────────────────────────────────

if (location.pathname.startsWith("/in/")) {
  scrapeWhenReady();
}
