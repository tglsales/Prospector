const FOLLOW_UP_DAYS = 7;
const WEBHOOK_URL =
  "http://localhost:5678/webhook/c9446f75-03f2-4fc9-b306-5ddb09d7d69f";

let activeProspectId = null;
let searchQuery = "";

// ── Message generation (via N8N → Anthropic) ───────────────────

const TOUCH_2_MESSAGES = {
  fr: "Pour te donner une idée concrète : un concurrent interagit avec un décideur chez un compte clé -> on t'avertit. Open pour en discuter ?",
  en: "Concrete example : a competitor engages with a decision-maker at one of your top accounts -> Your BDRs are instantly alerted. Open to talk ?",
};

const TOUCH_3_MESSAGES = {
  fr: "Dernier exemple : la plupart des sales suivent les job changes de leurs anciens champions à la main. Certains ont automatisé ce suivi et font un ROI x4 sur ce seul signal. Je suis toujours open pour te faire une démo 👍",
  en: "Last example: most salespeople track their past champions' job changes manually. Some have automated this and are seeing a 4x ROI from this single signal. Still open to give you a demo 👍",
};

async function generateTouchMessage(prospect, touchNumber, language) {
  if (touchNumber === 2)
    return TOUCH_2_MESSAGES[language] ?? TOUCH_2_MESSAGES.fr;
  if (touchNumber === 3)
    return TOUCH_3_MESSAGES[language] ?? TOUCH_3_MESSAGES.fr;
  const previousMessages = prospect.steps
    .slice(0, touchNumber - 1)
    .filter((step) => step.content)
    .map((step, index) => `Touch ${index + 1} sent:\n${step.content}`)
    .join("\n\n");

  const languageInstruction =
    language === "en"
      ? "Write in English. Lead directly. Short sentences. No greeting."
      : "Écris en français.";

  const { examples = [] } = await chrome.storage.local.get("examples");
  const examplesBlock =
    examples.length > 0
      ? `Here are recent messages I refined — learn from these edits:\n\n${examples
          .map((ex) => `Generated: "${ex.generated}"\nSent: "${ex.sent}"`)
          .join("\n\n")}`
      : "";

  const userMessage = [
    `Touch ${touchNumber} for ${prospect.firstName}, ${prospect.role} at ${prospect.company}.`,
    prospect.signal ? `Context / signal: ${prospect.signal}` : "",
    previousMessages,
    examplesBlock,
    languageInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userMessage }),
  });

  if (!response.ok) throw new Error("webhook-error");
  const data = await response.json();
  return data.message?.trim() ?? "";
}

// ── Storage helpers ────────────────────────────────────────────

async function getStorage() {
  return chrome.storage.local.get(["prospects", "currentProfile"]);
}

async function getProspects() {
  return chrome.storage.local.get("prospects");
}

async function saveProspects(prospects) {
  return chrome.storage.local.set({ prospects });
}

async function saveExample(generated, sent) {
  const { examples = [] } = await chrome.storage.local.get("examples");
  examples.push({ generated, sent });
  if (examples.length > 10) examples.shift();
  await chrome.storage.local.set({ examples });
}

// ── Data factory ───────────────────────────────────────────────

function buildNewProspect(profile, signal) {
  return {
    id: profile.id,
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    fullName: profile.fullName ?? "",
    role: profile.role ?? "",
    company: profile.company ?? "",
    photoUrl: profile.photoUrl ?? null,
    companyLogoUrl: profile.companyLogoUrl ?? null,
    signal,
    language: null,
    notes: "",
    addedAt: Date.now(),
    repliedAt: null,
    meetingAt: null,
    currentStep: 0,
    steps: [
      {
        number: 1,
        type: "message",
        delay: "J+0",
        content: null,
        sentAt: null,
        isDue: false,
      },
      {
        number: 2,
        type: "message",
        delay: "J+7",
        content: null,
        sentAt: null,
        isDue: false,
      },
      {
        number: 3,
        type: "message",
        delay: "J+14",
        content: null,
        sentAt: null,
        isDue: false,
      },
    ],
  };
}

// ── Avatar ─────────────────────────────────────────────────────

function buildAvatarHtml(prospect, size, ringColor = null) {
  const initials =
    (
      (prospect.firstName?.[0] ?? "") + (prospect.lastName?.[0] ?? "")
    ).toUpperCase() || "?";
  const ring = ringColor
    ? `box-shadow:0 0 0 2px #fff,0 0 0 4px ${ringColor};`
    : "";
  const inner = prospect.photoUrl
    ? `<img class="avatar-img" style="${ring}" src="${prospect.photoUrl}" alt="${prospect.fullName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="avatar-initials" style="display:none;${ring}">${initials}</div>`
    : `<div class="avatar-initials" style="${ring}">${initials}</div>`;
  const badge = prospect.companyLogoUrl
    ? `<div class="company-badge"><img src="${prospect.companyLogoUrl}" alt="" /></div>`
    : "";
  return `<div class="avatar-wrapper" style="--size:${size}px">${inner}${badge}</div>`;
}

function getRingColor(prospect) {
  if (prospect.meetingAt) return "#16a34a";
  if (prospect.repliedAt) return "#2563eb";
  if (prospect.steps?.some((step) => step.isDue)) return "#ef4444";
  return null;
}

// ── View navigation ────────────────────────────────────────────

function showListView() {
  document.getElementById("list-view").classList.remove("hidden");
  document.getElementById("detail-view").classList.add("hidden");
  document.getElementById("stats-view").classList.add("hidden");
}

function showDetailView() {
  document.getElementById("list-view").classList.add("hidden");
  document.getElementById("detail-view").classList.remove("hidden");
  document.getElementById("stats-view").classList.add("hidden");
}

function computeStats(prospects) {
  const entries = Object.values(prospects);
  const started = entries.filter(
    (prospect) => prospect.steps[0]?.sentAt,
  ).length;
  const replied = entries.filter((prospect) => prospect.repliedAt).length;
  const meetings = entries.filter((prospect) => prospect.meetingAt).length;
  const replyRate = started > 0 ? Math.round((replied / started) * 100) : 0;
  const conversionRate =
    started > 0 ? Math.round((meetings / started) * 100) : 0;
  return { started, replied, meetings, replyRate, conversionRate };
}

function showStatsView(prospects) {
  const { started, replied, meetings, replyRate, conversionRate } =
    computeStats(prospects);
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-card stat-card-full">
      <div class="stat-number">${started}</div>
      <div class="stat-label">Contacted</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${replied}</div>
      <div class="stat-label">Replied</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${meetings}</div>
      <div class="stat-label">Meetings</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${replyRate}%</div>
      <div class="stat-label">Reply rate</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${conversionRate}%</div>
      <div class="stat-label">Conversion</div>
    </div>
  `;
  document.getElementById("list-view").classList.add("hidden");
  document.getElementById("detail-view").classList.add("hidden");
  document.getElementById("stats-view").classList.remove("hidden");
}

// ── Rendering: List ────────────────────────────────────────────

function renderListView(prospects) {
  const container = document.getElementById("prospect-list");
  const statsEl = document.getElementById("list-stats");
  const entries = Object.values(prospects);

  if (entries.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No prospects in sequence.</p>';
    statsEl.classList.add("hidden");
    return;
  }

  const query = searchQuery.toLowerCase();
  const filtered = query
    ? entries.filter(
        (prospect) =>
          prospect.fullName.toLowerCase().includes(query) ||
          prospect.company.toLowerCase().includes(query),
      )
    : entries;

  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state">No results.</p>';
    statsEl.classList.add("hidden");
    return;
  }

  const followUpsDue = filtered.filter((prospect) =>
    prospect.steps.slice(1).some((step) => step.isDue),
  ).length;

  statsEl.classList.remove("hidden");
  statsEl.innerHTML =
    followUpsDue > 0
      ? `<span class="stat-pill stat-pill-due">Follow-ups due: ${followUpsDue}</span>`
      : '<span class="stat-pill stat-pill-new">No follow-ups due</span>';

  // 1=follow-up due, 2=to contact, 3=sent/done, 4=meeting, 5=replied
  const statusPriority = (prospect) => {
    if (prospect.repliedAt && !prospect.meetingAt) return 5;
    if (prospect.meetingAt) return 4;
    const isCompleted = prospect.currentStep >= prospect.steps.length;
    if (isCompleted) return 3;
    const nextStep = prospect.steps[prospect.currentStep];
    if (nextStep?.isDue) return 1;
    if (prospect.currentStep === 0) return 2;
    return 3;
  };

  filtered.sort((a, b) => {
    const diff = statusPriority(a) - statusPriority(b);
    return diff !== 0 ? diff : b.addedAt - a.addedAt;
  });

  container.innerHTML = filtered
    .map((prospect) => {
      const hasDue = prospect.steps.some((step) => step.isDue);
      const isCompleted = prospect.currentStep >= prospect.steps.length;
      const touchNames = ["First", "Second", "Third"];
      let stepLabel, badgeClass, borderClass;
      if (prospect.meetingAt) {
        stepLabel = "Meeting ✓";
        badgeClass = "badge-meeting";
        borderClass = "prospect-card--sent";
      } else if (prospect.repliedAt) {
        stepLabel = "Replied ✓";
        badgeClass = "badge-replied";
        borderClass = "prospect-card--replied";
      } else if (isCompleted) {
        stepLabel = "Done";
        badgeClass = "step-badge";
        borderClass = "prospect-card--done";
      } else {
        const nextStep = prospect.steps[prospect.currentStep];
        if (prospect.currentStep === 0 || nextStep?.isDue) {
          stepLabel =
            prospect.currentStep === 0 ? "To contact" : "To follow up";
          badgeClass = "badge-due";
          borderClass = "prospect-card--due";
        } else {
          stepLabel = "Sent";
          badgeClass = "badge-sent-pill";
          borderClass = "prospect-card--sent";
        }
      }

      return `
      <div class="prospect-card ${borderClass}" data-id="${prospect.id}">
        ${buildAvatarHtml(prospect, 36)}
        <div class="prospect-card-info">
          <span class="prospect-card-name">${prospect.fullName}</span>
          <span class="prospect-card-company text-muted">${prospect.company}</span>
        </div>
        <div class="prospect-card-meta">
          <span class="${badgeClass}">${stepLabel}</span>
          ${hasDue ? '<span class="badge-due">!</span>' : ""}
          <button class="btn-delete" data-id="${prospect.id}" title="Remove from sequence">×</button>
        </div>
      </div>
    `;
    })
    .join("");

  container.querySelectorAll(".prospect-card").forEach((card) => {
    card.addEventListener("click", async () => {
      activeProspectId = card.dataset.id;
      const { prospects: latestProspects = {} } = await getProspects();
      renderDetailView(latestProspects[activeProspectId], false);
      showDetailView();
    });
  });

  container.querySelectorAll(".btn-delete").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteProspect(button.dataset.id);
    });
  });
}

// ── Rendering: Detail ──────────────────────────────────────────

function renderDetailView(prospect, isNewProfile) {
  document.getElementById("prospect-avatar-wrapper").innerHTML =
    buildAvatarHtml(prospect, 56, getRingColor(prospect));
  const linkedinUrl = `https://www.linkedin.com${prospect.id}`;
  document.getElementById("prospect-name").innerHTML =
    `<a href="${linkedinUrl}" target="_blank" class="prospect-name-link">${prospect.fullName ?? ""}</a>`;
  document.getElementById("prospect-role").textContent = prospect.role ?? "";
  document.getElementById("prospect-company").textContent =
    prospect.company ?? "";

  const actionsDiv = document.getElementById("prospect-actions");
  if (isNewProfile) {
    actionsDiv.classList.add("hidden");
  } else {
    actionsDiv.classList.remove("hidden");
    const repliedBtn = document.getElementById("btn-prospect-replied");
    repliedBtn.disabled = !!prospect.repliedAt || !!prospect.meetingAt;
    repliedBtn.textContent = prospect.repliedAt ? "Replied ✓" : "Replied";
    repliedBtn.classList.toggle(
      "btn-prospect-replied--done",
      !!prospect.repliedAt,
    );
    const meetingBtn = document.getElementById("btn-prospect-meeting");
    meetingBtn.disabled = !!prospect.meetingAt;
    meetingBtn.textContent = prospect.meetingAt
      ? "Meeting Booked ✓"
      : "Meeting Booked";
    meetingBtn.classList.toggle(
      "btn-prospect-meeting--done",
      !!prospect.meetingAt,
    );
  }

  const newForm = document.getElementById("new-prospect-form");
  const stepsContainer = document.getElementById("steps-container");
  const notesContainer = document.getElementById("notes-container");
  const notesInput = document.getElementById("notes-input");

  const editBtn = document.getElementById("btn-edit-prospect");
  const saveBtn = document.getElementById("btn-save-prospect");

  if (isNewProfile) {
    document.getElementById("role-input").value = prospect.role ?? "";
    document.getElementById("company-input").value = prospect.company ?? "";
    newForm.classList.remove("hidden");
    stepsContainer.classList.add("hidden");
    notesContainer.classList.add("hidden");
    editBtn.classList.add("hidden");
    saveBtn.classList.add("hidden");
  } else {
    newForm.classList.add("hidden");
    stepsContainer.classList.remove("hidden");
    notesContainer.classList.remove("hidden");
    notesInput.value = prospect.notes ?? "";
    editBtn.classList.remove("hidden");
    saveBtn.classList.add("hidden");
    document.getElementById("prospect-role").classList.remove("hidden");
    document.getElementById("prospect-company").classList.remove("hidden");
    document.getElementById("edit-role-input").classList.add("hidden");
    document.getElementById("edit-company-input").classList.add("hidden");

    renderSteps(prospect);
  }
}

function getStepStatus(prospect, stepIndex) {
  const step = prospect.steps[stepIndex];
  if (step.sentAt) return "sent";
  if (step.isDue) return "due";
  if (stepIndex === prospect.currentStep) return "current";
  return "locked";
}

function renderSteps(prospect) {
  const container = document.getElementById("steps-list");
  const typeLabels = { connection_request: "Message", message: "Message" };

  container.innerHTML = prospect.steps
    .map((step, stepIndex) => {
      const status = getStepStatus(prospect, stepIndex);
      const isSent = status === "sent";
      const isDue = status === "due";
      const isActionable = status === "current" || isDue;
      const isLocked = status === "locked";

      const dotClass = isSent
        ? "timeline-dot--sent"
        : isDue
          ? "timeline-dot--due"
          : isActionable
            ? "timeline-dot--active"
            : "";

      const contentBlock = isSent
        ? `<p class="step-content" data-step-index="${stepIndex}">${step.content}</p>
         <button class="btn-copy" data-step-index="${stepIndex}">Copy</button>`
        : `<textarea class="step-content-edit" data-step-index="${stepIndex}" placeholder="Write your draft or generate…">${step.content ?? ""}</textarea>
         ${step.content ? `<button class="btn-copy" data-step-index="${stepIndex}">Copy</button>` : ""}`;

      const generateButtons = isActionable
        ? `<div class="btn-generate-flags">
           <button class="btn-flag ${prospect.language === "fr" ? "btn-flag--active" : ""}" data-step-index="${stepIndex}" data-language="fr">🇫🇷</button>
           <button class="btn-flag ${prospect.language === "en" ? "btn-flag--active" : ""}" data-step-index="${stepIndex}" data-language="en">🇺🇸</button>
         </div>`
        : "";

      const sentButton =
        isActionable && step.content
          ? `<button class="btn-sent" data-step-index="${stepIndex}">Mark as sent</button>`
          : "";

      return `
      <div class="timeline-item">
        <div class="timeline-col">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-connector"></div>
        </div>
        <div class="step-card ${isActionable ? "step-active" : ""} ${isSent ? "step-sent" : ""} ${isDue ? "step-due" : ""} ${isLocked ? "step-locked" : ""}">
          <div class="step-header">
            <span class="step-label">${typeLabels[step.type]} · ${step.delay}</span>
            ${isSent ? '<span class="badge-sent">Sent ✓</span>' : ""}
            ${isDue ? '<span class="badge-due">Follow-up due!</span>' : ""}
          </div>
          ${contentBlock}
          ${generateButtons}
          ${sentButton}
        </div>
      </div>
    `;
    })
    .join("");

  container.querySelectorAll(".btn-copy").forEach((button) => {
    button.addEventListener("click", () => {
      const stepIndex = parseInt(button.dataset.stepIndex);
      const textarea = container.querySelector(
        `.step-content-edit[data-step-index="${stepIndex}"]`,
      );
      const paragraph = container.querySelector(
        `.step-content[data-step-index="${stepIndex}"]`,
      );
      const text = textarea ? textarea.value : (paragraph?.textContent ?? "");
      navigator.clipboard.writeText(text);
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1500);
    });
  });

  container.querySelectorAll(".step-content-edit").forEach((textarea) => {
    const fit = (el) => {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    };
    fit(textarea);
    textarea.addEventListener("input", () => fit(textarea));
    textarea.addEventListener("blur", async () => {
      const stepIndex = parseInt(textarea.dataset.stepIndex);
      const { prospects = {} } = await getProspects();
      const prospect = prospects[activeProspectId];
      if (!prospect) return;
      prospect.steps[stepIndex].content = textarea.value;
      prospects[activeProspectId] = prospect;
      await saveProspects(prospects);
    });
  });

  container.querySelectorAll(".btn-sent").forEach((button) => {
    button.addEventListener("click", async () => {
      const stepIndex = parseInt(button.dataset.stepIndex);
      await markStepSent(activeProspectId, stepIndex);
      const { prospects = {} } = await getProspects();
      renderSteps(prospects[activeProspectId]);
      renderListView(prospects);
    });
  });

  container.querySelectorAll(".btn-flag").forEach((button) => {
    button.addEventListener("click", async () => {
      const stepIndex = parseInt(button.dataset.stepIndex);
      const language = button.dataset.language;
      const siblings = container.querySelectorAll(
        `.btn-flag[data-step-index="${stepIndex}"]`,
      );

      siblings.forEach((btn) => {
        btn.disabled = true;
      });
      button.textContent = "…";

      try {
        const { prospects = {} } = await getProspects();
        const prospect = prospects[activeProspectId];
        const content = await generateTouchMessage(
          prospect,
          stepIndex + 1,
          language,
        );
        prospect.steps[stepIndex].content = content;
        prospect.steps[stepIndex].generatedContent = content;
        prospect.language = language;
        prospects[activeProspectId] = prospect;
        await saveProspects(prospects);
        renderSteps(prospects[activeProspectId]);
      } catch (error) {
        siblings.forEach((btn) => {
          btn.disabled = false;
        });
        const flag = language === "fr" ? "🇫🇷" : "🇺🇸";
        button.textContent = "✕";
        setTimeout(() => {
          button.textContent = flag;
        }, 3000);
      }
    });
  });
}

// ── Actions ────────────────────────────────────────────────────

async function markProspectMeeting(prospectId) {
  const { prospects = {} } = await getProspects();
  const prospect = prospects[prospectId];
  if (!prospect) return;
  prospect.meetingAt = Date.now();
  prospect.steps.forEach((_, stepIndex) => {
    chrome.alarms.clear(`followup|${prospectId}|${stepIndex + 1}`);
  });
  prospects[prospectId] = prospect;
  await saveProspects(prospects);
}

async function markProspectReplied(prospectId) {
  const { prospects = {} } = await getProspects();
  const prospect = prospects[prospectId];
  if (!prospect) return;
  prospect.repliedAt = Date.now();
  prospect.steps.forEach((_, stepIndex) => {
    chrome.alarms.clear(`followup|${prospectId}|${stepIndex + 1}`);
  });
  prospects[prospectId] = prospect;
  await saveProspects(prospects);
}

async function deleteProspect(prospectId) {
  const { prospects = {} } = await getProspects();
  const prospect = prospects[prospectId];

  // Cancel pending follow-up alarms before removing
  prospect?.steps.forEach((_, stepIndex) => {
    chrome.alarms.clear(`followup|${prospectId}|${stepIndex + 1}`);
  });

  delete prospects[prospectId];
  await saveProspects(prospects);

  if (activeProspectId === prospectId) {
    activeProspectId = null;
    showListView();
  }

  renderListView(prospects);
}

async function addProspectToSequence(profile) {
  const role = document.getElementById("role-input").value.trim();
  const company =
    document.getElementById("company-input").value.trim() || profile.company;
  const signal = document.getElementById("signal-input").value.trim();
  const { prospects = {} } = await getProspects();
  const prospect = buildNewProspect({ ...profile, role, company }, signal);
  prospects[profile.id] = prospect;
  await saveProspects(prospects);
  activeProspectId = profile.id;
  renderDetailView(prospect, false);
  renderListView(prospects);
}

async function markStepSent(prospectId, stepIndex) {
  const { prospects = {} } = await getProspects();
  const prospect = prospects[prospectId];

  const step = prospect.steps[stepIndex];
  if (
    step.generatedContent &&
    step.content &&
    step.content !== step.generatedContent
  ) {
    await saveExample(step.generatedContent, step.content);
  }

  prospect.steps[stepIndex].sentAt = Date.now();
  prospect.steps[stepIndex].isDue = false;
  prospect.currentStep = stepIndex + 1;

  const nextStepIndex = stepIndex + 1;
  if (nextStepIndex < prospect.steps.length) {
    const alarmName = `followup|${prospectId}|${nextStepIndex + 1}`;
    chrome.alarms.create(alarmName, {
      delayInMinutes: FOLLOW_UP_DAYS * 24 * 60,
    });
  }

  prospects[prospectId] = prospect;
  await saveProspects(prospects);
}

// ── Init ───────────────────────────────────────────────────────

async function init() {
  const { prospects = {}, currentProfile } = await getStorage();

  renderListView(prospects);

  if (currentProfile) {
    activeProspectId = currentProfile.id;
    if (prospects[currentProfile.id]) {
      // Refresh photos from fresh scrape
      if (currentProfile.photoUrl)
        prospects[currentProfile.id].photoUrl = currentProfile.photoUrl;
      if (currentProfile.companyLogoUrl)
        prospects[currentProfile.id].companyLogoUrl =
          currentProfile.companyLogoUrl;
      await saveProspects(prospects);
      renderDetailView(prospects[currentProfile.id], false);
    } else {
      renderDetailView(currentProfile, true);
    }
    showDetailView();
  } else {
    showListView();
  }

  // Back button
  document.getElementById("btn-back").addEventListener("click", () => {
    activeProspectId = null;
    showListView();
  });

  // Edit / save prospect info
  document.getElementById("btn-edit-prospect").addEventListener("click", () => {
    const roleEl = document.getElementById("prospect-role");
    const companyEl = document.getElementById("prospect-company");
    document.getElementById("edit-role-input").value = roleEl.textContent;
    document.getElementById("edit-company-input").value = companyEl.textContent;
    roleEl.classList.add("hidden");
    companyEl.classList.add("hidden");
    document.getElementById("edit-role-input").classList.remove("hidden");
    document.getElementById("edit-company-input").classList.remove("hidden");
    document.getElementById("btn-edit-prospect").classList.add("hidden");
    document.getElementById("btn-save-prospect").classList.remove("hidden");
  });

  document
    .getElementById("btn-save-prospect")
    .addEventListener("click", async () => {
      if (!activeProspectId) return;
      const role = document.getElementById("edit-role-input").value.trim();
      const company = document
        .getElementById("edit-company-input")
        .value.trim();
      const { prospects = {} } = await getProspects();
      const prospect = prospects[activeProspectId];
      if (!prospect) return;
      prospect.role = role;
      prospect.company = company;
      prospects[activeProspectId] = prospect;
      await saveProspects(prospects);
      document.getElementById("prospect-role").textContent = role;
      document.getElementById("prospect-company").textContent = company;
      document.getElementById("prospect-role").classList.remove("hidden");
      document.getElementById("prospect-company").classList.remove("hidden");
      document.getElementById("edit-role-input").classList.add("hidden");
      document.getElementById("edit-company-input").classList.add("hidden");
      document.getElementById("btn-edit-prospect").classList.remove("hidden");
      document.getElementById("btn-save-prospect").classList.add("hidden");
    });

  // Search
  document
    .getElementById("btn-search-toggle")
    .addEventListener("click", async () => {
      const bar = document.getElementById("search-bar");
      const isOpen = !bar.classList.contains("hidden");
      if (isOpen) {
        bar.classList.add("hidden");
        searchQuery = "";
        document.getElementById("search-input").value = "";
        const { prospects = {} } = await getProspects();
        renderListView(prospects);
      } else {
        bar.classList.remove("hidden");
        document.getElementById("search-input").focus();
      }
    });

  document
    .getElementById("search-input")
    .addEventListener("input", async (event) => {
      searchQuery = event.target.value.trim();
      const { prospects = {} } = await getProspects();
      renderListView(prospects);
    });

  // Stats button
  document.getElementById("btn-stats").addEventListener("click", async () => {
    const { prospects = {} } = await getProspects();
    showStatsView(prospects);
  });

  document.getElementById("btn-stats-back").addEventListener("click", () => {
    showListView();
  });

  // Refresh button — re-scrape the current tab
  document.getElementById("btn-refresh").addEventListener("click", async () => {
    const btn = document.getElementById("btn-refresh");
    btn.textContent = "…";
    btn.disabled = true;
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      if (tab.url?.includes("linkedin.com/in/")) {
        document.getElementById("loading-profile").classList.remove("hidden");
      }
      chrome.tabs.sendMessage(tab.id, { type: "REFRESH_PROFILE" });
    }
    setTimeout(() => {
      btn.textContent = "↺";
      btn.disabled = false;
    }, 1500);
  });

  // Arrow button in list view header → jump to currently open LinkedIn profile
  document
    .getElementById("btn-go-to-current")
    .addEventListener("click", async () => {
      const { currentProfile: profile, prospects: latestProspects = {} } =
        await getStorage();
      if (!profile) return;
      activeProspectId = profile.id;
      if (latestProspects[profile.id]) {
        renderDetailView(latestProspects[profile.id], false);
      } else {
        renderDetailView(profile, true);
      }
      showDetailView();
    });

  // Replied button
  document
    .getElementById("btn-prospect-replied")
    .addEventListener("click", async () => {
      if (!activeProspectId) return;
      await markProspectReplied(activeProspectId);
      const { prospects = {} } = await getProspects();
      renderDetailView(prospects[activeProspectId], false);
      renderListView(prospects);
    });

  // Meeting Booked button
  document
    .getElementById("btn-prospect-meeting")
    .addEventListener("click", async () => {
      if (!activeProspectId) return;
      await markProspectMeeting(activeProspectId);
      const { prospects = {} } = await getProspects();
      renderDetailView(prospects[activeProspectId], false);
      renderListView(prospects);
    });

  // Add to sequence button
  document
    .getElementById("btn-add-sequence")
    .addEventListener("click", async () => {
      const { currentProfile: profile } =
        await chrome.storage.local.get("currentProfile");
      if (!profile) return;
      await addProspectToSequence(profile);
    });

  // Notes auto-save
  document.getElementById("notes-input").addEventListener("blur", async () => {
    if (!activeProspectId) return;
    const { prospects = {} } = await getProspects();
    const prospect = prospects[activeProspectId];
    if (!prospect) return;
    prospect.notes = document.getElementById("notes-input").value;
    prospects[activeProspectId] = prospect;
    await saveProspects(prospects);
  });

  // React to storage changes from content.js (new LinkedIn profile opened)
  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.currentProfile) {
      const newProfile = changes.currentProfile.newValue;
      document.getElementById("loading-profile").classList.add("hidden");
      const { prospects: latestProspects = {} } = await getProspects();

      renderListView(latestProspects);

      if (newProfile) {
        activeProspectId = newProfile.id;
        if (latestProspects[newProfile.id]) {
          // Refresh photos from fresh scrape
          if (newProfile.photoUrl)
            latestProspects[newProfile.id].photoUrl = newProfile.photoUrl;
          if (newProfile.companyLogoUrl)
            latestProspects[newProfile.id].companyLogoUrl =
              newProfile.companyLogoUrl;
          await saveProspects(latestProspects);
          renderDetailView(latestProspects[newProfile.id], false);
        } else {
          renderDetailView(newProfile, true);
        }
        showDetailView();
      }
    }

    if (changes.prospects && activeProspectId) {
      const updatedProspects = changes.prospects.newValue ?? {};
      renderListView(updatedProspects);
      if (updatedProspects[activeProspectId]) {
        renderSteps(updatedProspects[activeProspectId]);
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
