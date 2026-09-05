import {
  STATUS,
  buildCue,
  deduplicateItems,
  parseImportedContent,
  reviewedToday,
  sortForReview,
  summarize,
} from "./core.js";

const STORAGE_KEY = "englishRecite.state.v1";
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

const TYPE_LABELS = {
  mixed: "混合内容",
  word: "单词",
  phrase: "短语",
  sentence: "句子",
  text: "课文",
};

const STATUS_LABELS = {
  [STATUS.NEW]: "未标记",
  [STATUS.UNKNOWN]: "不认识",
  [STATUS.FUZZY]: "模糊",
  [STATUS.MASTERED]: "已掌握",
};

const DEMO_ITEMS = [
  ["我对科学感兴趣", "I am interested in science."],
  ["我性格外向", "I am outgoing."],
  ["他对我友好/友善。", "He is friendly/kind to me."],
  ["我喜欢交新朋友", "I like making new friends."],
  ["我的爱好是拉小提琴", "My hobby is playing the violin."],
  ["我希望在中学学到更多东西", "I hope to learn more in middle school."],
  ["我想要和我的同班同学和睦相处", "I want to get on well with my classmates."],
  ["我期待这里的新生活", "I'm looking forward to the new life here."],
  ["我希望我们可以互相帮助", "I hope we can help each other."],
  ["为上课做好准备", "get ready for class"],
  ["我的笔记本不见了", "My notebooks are missing."],
  ["一本英汉词典", "an English-Chinese dictionary"],
  ["英语学习、成功的秘诀", "the secret to English learning/success"],
  ["我通过使用它来学习英语", "I learn English by using it."],
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  saveIndicator: $("#saveIndicator"),
  assignmentCount: $("#assignmentCount"),
  sideAssignmentList: $("#sideAssignmentList"),
  todayLabel: $("#todayLabel"),
  emptyState: $("#emptyState"),
  dashboardContent: $("#dashboardContent"),
  activeTypeChip: $("#activeTypeChip"),
  activeAssignmentTitle: $("#activeAssignmentTitle"),
  activeAssignmentMeta: $("#activeAssignmentMeta"),
  progressRing: $("#progressRing"),
  masteryPercent: $("#masteryPercent"),
  masteredCount: $("#masteredCount"),
  fuzzyCount: $("#fuzzyCount"),
  unknownCount: $("#unknownCount"),
  todayReviewedCount: $("#todayReviewedCount"),
  libraryList: $("#libraryList"),
  startStudyButton: $("#startStudyButton"),
  focusStudyButton: $("#focusStudyButton"),
  loadDemoButton: $("#loadDemoButton"),
  studyAssignmentTitle: $("#studyAssignmentTitle"),
  studyCounter: $("#studyCounter"),
  studyModeSelect: $("#studyModeSelect"),
  studyProgressBar: $("#studyProgressBar"),
  currentStatusPill: $("#currentStatusPill"),
  promptLabel: $("#promptLabel"),
  promptText: $("#promptText"),
  thinkHint: $("#thinkHint"),
  answerPanel: $("#answerPanel"),
  answerText: $("#answerText"),
  itemNote: $("#itemNote"),
  speakButton: $("#speakButton"),
  previousItemButton: $("#previousItemButton"),
  nextItemButton: $("#nextItemButton"),
  continuousPlayButton: $("#continuousPlayButton"),
  editItemButton: $("#editItemButton"),
  importDialog: $("#importDialog"),
  importForm: $("#importForm"),
  assignmentTitleInput: $("#assignmentTitleInput"),
  assignmentTypeInput: $("#assignmentTypeInput"),
  contentInput: $("#contentInput"),
  paragraphSplitInput: $("#paragraphSplitInput"),
  contentFileInput: $("#contentFileInput"),
  selectedFileName: $("#selectedFileName"),
  photoFileInput: $("#photoFileInput"),
  photoPreviewWrap: $("#photoPreviewWrap"),
  photoPreview: $("#photoPreview"),
  ocrButton: $("#ocrButton"),
  ocrProgress: $("#ocrProgress"),
  ocrProgressBar: $("#ocrProgressBar"),
  ocrProgressText: $("#ocrProgressText"),
  previewImportButton: $("#previewImportButton"),
  importPreview: $("#importPreview"),
  previewHeading: $("#previewHeading"),
  previewList: $("#previewList"),
  importError: $("#importError"),
  editItemDialog: $("#editItemDialog"),
  editItemForm: $("#editItemForm"),
  editPromptInput: $("#editPromptInput"),
  editAnswerInput: $("#editAnswerInput"),
  editNoteInput: $("#editNoteInput"),
  deleteItemButton: $("#deleteItemButton"),
  settingsButton: $("#settingsButton"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  voiceSelect: $("#voiceSelect"),
  rateSelect: $("#rateSelect"),
  repeatSelect: $("#repeatSelect"),
  autoSpeakInput: $("#autoSpeakInput"),
  testSpeechButton: $("#testSpeechButton"),
  ttsSettingsButton: $("#ttsSettingsButton"),
  ttsStatusText: $("#ttsStatusText"),
  exportBackupButton: $("#exportBackupButton"),
  backupFileInput: $("#backupFileInput"),
  completionDialog: $("#completionDialog"),
  completionSummary: $("#completionSummary"),
  reviewAgainButton: $("#reviewAgainButton"),
  installButton: $("#installButton"),
  toast: $("#toast"),
};

function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultState() {
  return {
    version: 1,
    activeAssignmentId: null,
    assignments: [],
    settings: {
      voiceURI: "",
      rate: 0.85,
      repeat: 2,
      autoSpeak: true,
    },
  };
}

function normalizeItem(item) {
  return {
    id: item.id || createId("item"),
    prompt: String(item.prompt || "").trim(),
    answer: String(item.answer || "").trim(),
    note: String(item.note || "").trim(),
    status: Object.values(STATUS).includes(item.status) ? item.status : STATUS.NEW,
    reviewCount: Number(item.reviewCount) || 0,
    lastReviewed: item.lastReviewed || null,
  };
}

function normalizeAssignment(assignment) {
  return {
    id: assignment.id || createId("assignment"),
    title: String(assignment.title || "未命名背诵作业").trim(),
    type: TYPE_LABELS[assignment.type] ? assignment.type : "mixed",
    createdAt: assignment.createdAt || new Date().toISOString(),
    updatedAt: assignment.updatedAt || assignment.createdAt || new Date().toISOString(),
    items: Array.isArray(assignment.items) ? assignment.items.map(normalizeItem) : [],
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.assignments)) return defaultState();
    const base = defaultState();
    const assignments = saved.assignments.map(normalizeAssignment);
    const activeExists = assignments.some((assignment) => assignment.id === saved.activeAssignmentId);
    return {
      ...base,
      ...saved,
      assignments,
      activeAssignmentId: activeExists ? saved.activeAssignmentId : assignments[0]?.id || null,
      settings: { ...base.settings, ...(saved.settings || {}) },
    };
  } catch {
    return defaultState();
  }
}

let state = loadState();
let currentView = "home";
let session = null;
let parsedImportItems = [];
let importFileFormat = "auto";
let selectedPhotoFile = null;
let photoObjectUrl = "";
let toastTimer = null;
let saveTimer = null;
let speechRunId = 0;
let continuousPlaying = false;
let nativeTtsCleanup = null;
let deferredInstallPrompt = null;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(iso));
}

function getDefaultTitle() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日英语背诵`;
}

function showToast(message, duration = 2200) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

function saveState() {
  try {
    elements.saveIndicator.textContent = "正在保存…";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      elements.saveIndicator.textContent = "已保存在本机";
    }, 350);
  } catch {
    elements.saveIndicator.textContent = "保存失败";
    showToast("本机存储空间不足，请先导出备份。", 3500);
  }
}

function getActiveAssignment() {
  return state.assignments.find((assignment) => assignment.id === state.activeAssignmentId) || null;
}

function setActiveAssignment(id) {
  if (!state.assignments.some((assignment) => assignment.id === id)) return;
  state.activeAssignmentId = id;
  saveState();
  renderAll();
}

function showView(name) {
  stopSpeechAndContinuous();
  currentView = name;
  $$(".view").forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });
  $$("[data-view-target]").forEach((button) => {
    const target = button.dataset.viewTarget;
    const active = target === name || (name === "study" && target === "home");
    button.classList.toggle("active", active);
  });
  document.body.classList.toggle("is-studying", name === "study");
  $("#mainContent")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSideAssignments() {
  elements.assignmentCount.textContent = state.assignments.length;
  if (!state.assignments.length) {
    elements.sideAssignmentList.innerHTML = '<p class="muted" style="font-size:12px">还没有作业</p>';
    return;
  }

  elements.sideAssignmentList.innerHTML = state.assignments
    .map((assignment) => {
      const summary = summarize(assignment.items);
      return `
        <button class="side-assignment ${assignment.id === state.activeAssignmentId ? "active" : ""}" type="button" data-select-assignment="${escapeHtml(assignment.id)}">
          <strong>${escapeHtml(assignment.title)}</strong>
          <span>${summary.mastered}/${summary.total} 已掌握 · ${summary.mastery}%</span>
        </button>`;
    })
    .join("");
}

function renderHome() {
  const now = new Date();
  elements.todayLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);

  const assignment = getActiveAssignment();
  const isEmpty = !assignment;
  elements.emptyState.hidden = !isEmpty;
  elements.dashboardContent.hidden = isEmpty;
  if (!assignment) return;

  const summary = summarize(assignment.items);
  const todayReviewed = assignment.items.filter((item) => reviewedToday(item)).length;
  elements.activeTypeChip.textContent = TYPE_LABELS[assignment.type];
  elements.activeAssignmentTitle.textContent = assignment.title;
  elements.activeAssignmentMeta.textContent = `共 ${summary.total} 项 · ${summary.unknown + summary.fuzzy} 项需要重点复习`;
  elements.progressRing.style.setProperty("--progress", summary.mastery);
  elements.progressRing.setAttribute("aria-label", `掌握进度 ${summary.mastery}%`);
  elements.masteryPercent.textContent = `${summary.mastery}%`;
  elements.masteredCount.textContent = summary.mastered;
  elements.fuzzyCount.textContent = summary.fuzzy;
  elements.unknownCount.textContent = summary.unknown;
  elements.todayReviewedCount.textContent = todayReviewed;
  elements.focusStudyButton.disabled = summary.unknown + summary.fuzzy === 0;
  elements.focusStudyButton.title = elements.focusStudyButton.disabled ? "还没有模糊或不认识的内容" : "先背模糊和不认识的内容";
}

function renderLibrary() {
  if (!state.assignments.length) {
    elements.libraryList.innerHTML = `
      <div class="empty-state" style="min-height:390px">
        <h2>作业本还是空的</h2>
        <p>上传今天的单词、短语、句子或课文后，会保存在这里。</p>
        <button class="button button-primary" type="button" data-action="import">添加第一份作业</button>
      </div>`;
    return;
  }

  elements.libraryList.innerHTML = state.assignments
    .map((assignment) => {
      const summary = summarize(assignment.items);
      const focusCount = summary.unknown + summary.fuzzy;
      return `
        <article class="library-card" data-assignment-card="${escapeHtml(assignment.id)}">
          <div class="library-card-main">
            <div class="library-card-title-row">
              <span class="type-chip" style="color:var(--primary);background:var(--primary-soft)">${escapeHtml(TYPE_LABELS[assignment.type])}</span>
              <h2>${escapeHtml(assignment.title)}</h2>
            </div>
            <div class="library-card-meta">
              <span>${formatDate(assignment.createdAt)} 添加</span>
              <span>共 ${summary.total} 项</span>
              <span>${summary.mastered} 项已掌握</span>
              <span>${focusCount} 项待重点复习</span>
            </div>
            <div class="mini-progress" aria-label="已掌握 ${summary.mastery}%"><span style="width:${summary.mastery}%"></span></div>
          </div>
          <div class="library-card-actions">
            <button class="button button-secondary" type="button" data-assignment-action="focus" data-assignment-id="${escapeHtml(assignment.id)}" ${focusCount ? "" : "disabled"}>重点复习</button>
            <button class="button button-primary" type="button" data-assignment-action="start" data-assignment-id="${escapeHtml(assignment.id)}">开始背诵</button>
            <button class="button button-quiet menu-button" type="button" data-assignment-action="export" data-assignment-id="${escapeHtml(assignment.id)}" title="导出这一份作业">导出</button>
            <button class="button button-quiet menu-button danger-text" type="button" data-assignment-action="delete" data-assignment-id="${escapeHtml(assignment.id)}" title="删除作业">删除</button>
          </div>
        </article>`;
    })
    .join("");
}

function renderAll() {
  renderSideAssignments();
  renderHome();
  renderLibrary();
}

function createImportedItem(item) {
  return normalizeItem({ ...item, id: createId("item"), status: STATUS.NEW });
}

function addDemoAssignment() {
  const existing = state.assignments.find((assignment) => assignment.title === "9.3 英语背诵示例");
  if (existing) {
    setActiveAssignment(existing.id);
    showView("home");
    showToast("已打开示例作业");
    return;
  }

  const now = new Date().toISOString();
  const assignment = normalizeAssignment({
    id: createId("assignment"),
    title: "9.3 英语背诵示例",
    type: "mixed",
    createdAt: now,
    updatedAt: now,
    items: DEMO_ITEMS.map(([prompt, answer]) => createImportedItem({ prompt, answer })),
  });
  state.assignments.unshift(assignment);
  state.activeAssignmentId = assignment.id;
  saveState();
  renderAll();
  showView("home");
  showToast("已根据图片加入 14 条示例内容");
}

function sessionItemsFor(assignment, filter) {
  const source = filter === "focus"
    ? assignment.items.filter((item) => item.status === STATUS.UNKNOWN || item.status === STATUS.FUZZY)
    : assignment.items;
  return sortForReview(source);
}

function startStudy(filter = "all", assignmentId = state.activeAssignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment || !assignment.items.length) {
    showToast("这份作业还没有可背诵的内容");
    return;
  }

  const items = sessionItemsFor(assignment, filter);
  if (!items.length) {
    showToast("太棒了，目前没有需要重点复习的内容！");
    return;
  }

  state.activeAssignmentId = assignment.id;
  saveState();
  const withoutPrompt = items.filter((item) => !item.prompt).length;
  const mode = assignment.type === "text" || withoutPrompt > items.length / 2 ? "follow" : "recall";
  session = {
    assignmentId: assignment.id,
    itemIds: items.map((item) => item.id),
    index: 0,
    filter,
    mode,
    revealed: mode === "follow",
  };
  elements.studyModeSelect.value = mode;
  showView("study");
  renderStudy();

  if (mode === "follow" && state.settings.autoSpeak) {
    speakCurrent();
  }
}

function getSessionAssignment() {
  return state.assignments.find((assignment) => assignment.id === session?.assignmentId) || null;
}

function getCurrentItem() {
  const assignment = getSessionAssignment();
  const id = session?.itemIds[session.index];
  return assignment?.items.find((item) => item.id === id) || null;
}

function renderStudy() {
  const assignment = getSessionAssignment();
  const item = getCurrentItem();
  if (!assignment || !item) {
    finishSession();
    return;
  }

  const count = session.itemIds.length;
  const position = session.index + 1;
  elements.studyAssignmentTitle.textContent = assignment.title;
  elements.studyCounter.textContent = `${position} / ${count}`;
  elements.studyProgressBar.style.width = `${(position / count) * 100}%`;
  elements.studyModeSelect.value = session.mode;

  elements.currentStatusPill.textContent = STATUS_LABELS[item.status] || STATUS_LABELS[STATUS.NEW];
  elements.currentStatusPill.className = `status-pill status-${item.status || STATUS.NEW}`;
  $$(".status-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.status === item.status);
  });

  if (session.mode === "follow") {
    elements.promptLabel.textContent = item.prompt ? "中文提示" : "跟读练习";
    elements.promptText.textContent = item.prompt || "听一遍，再清楚地跟读";
    elements.thinkHint.textContent = "可点击英文或右上角朗读按钮再听一遍";
    session.revealed = true;
  } else if (item.prompt) {
    elements.promptLabel.textContent = "中文提示";
    elements.promptText.textContent = item.prompt;
    elements.thinkHint.textContent = "先在心里或大声说出英文，再点开答案";
  } else {
    elements.promptLabel.textContent = "开头提示";
    elements.promptText.textContent = buildCue(item.answer);
    elements.thinkHint.textContent = "根据开头提示背出整句或整段，再查看全文";
  }

  elements.answerText.textContent = item.answer || "（缺少英文内容，请点右上角编辑）";
  elements.answerPanel.classList.toggle("concealed", !session.revealed);
  elements.answerPanel.setAttribute("aria-expanded", String(session.revealed));
  elements.itemNote.textContent = item.note || "";
  elements.itemNote.hidden = !item.note;
  elements.previousItemButton.disabled = session.index === 0;
  elements.nextItemButton.textContent = session.index === count - 1 ? "完成本轮" : "下一条";
  updateContinuousButton();
}

function revealAnswer() {
  if (!session || session.revealed) {
    speakCurrent();
    return;
  }
  session.revealed = true;
  renderStudy();
  if (state.settings.autoSpeak) speakCurrent();
}

function markCurrentItem(status) {
  const item = getCurrentItem();
  const assignment = getSessionAssignment();
  if (!item || !assignment) return;
  stopSpeechAndContinuous();
  item.status = status;
  item.lastReviewed = new Date().toISOString();
  item.reviewCount = (Number(item.reviewCount) || 0) + 1;
  assignment.updatedAt = new Date().toISOString();
  saveState();
  renderStudy();
  window.setTimeout(() => moveItem(1), 180);
}

function moveItem(direction) {
  if (!session) return;
  stopSpeechAndContinuous();
  const nextIndex = session.index + direction;
  if (nextIndex < 0) return;
  if (nextIndex >= session.itemIds.length) {
    finishSession();
    return;
  }
  session.index = nextIndex;
  session.revealed = session.mode === "follow";
  renderStudy();
  if (session.mode === "follow" && state.settings.autoSpeak) speakCurrent();
}

function finishSession() {
  stopSpeechAndContinuous();
  const assignment = getSessionAssignment();
  if (!assignment) {
    showView("home");
    return;
  }
  const sessionItems = session.itemIds
    .map((id) => assignment.items.find((item) => item.id === id))
    .filter(Boolean);
  const summary = summarize(sessionItems);
  elements.completionSummary.textContent = `本轮 ${summary.total} 项：已掌握 ${summary.mastered} 项，模糊 ${summary.fuzzy} 项，不认识 ${summary.unknown} 项。`;
  elements.reviewAgainButton.hidden = summary.fuzzy + summary.unknown === 0;
  renderAll();
  elements.completionDialog.showModal();
}

function chooseVoice() {
  const voices = speechSynthesis.getVoices();
  if (state.settings.voiceURI) {
    const selected = voices.find((voice) => voice.voiceURI === state.settings.voiceURI);
    if (selected) return selected;
  }
  const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang));
  return english.find((voice) => /Samantha|Google US English|Microsoft.*English/i.test(voice.name))
    || english.find((voice) => /^en[-_]US/i.test(voice.lang))
    || english[0]
    || null;
}

function hasNativeTtsBridge() {
  return typeof window.AndroidTts?.speak === "function";
}

function updateTtsStatus() {
  const hasNativeTts = hasNativeTtsBridge();
  elements.ttsSettingsButton.hidden = !hasNativeTts || typeof window.AndroidTts?.openSettings !== "function";
  if (!hasNativeTts) {
    elements.ttsStatusText.textContent = "网页朗读由浏览器提供。";
    return;
  }

  let status = "initializing";
  try {
    status = typeof window.AndroidTts?.getStatus === "function"
      ? String(window.AndroidTts.getStatus())
      : "ready";
  } catch {
    status = "unavailable";
  }
  if (status.startsWith("ready")) {
    const engine = status.split(":").slice(1).join(":");
    const engineName = engine === "com.google.android.tts"
      ? "Google 文字转语音"
      : /iflytek|speechcloud/i.test(engine)
        ? "讯飞语音"
        : "系统文字转语音";
    elements.ttsStatusText.textContent = `安卓朗读服务已就绪：${engineName}`;
  } else if (status === "initializing") {
    elements.ttsStatusText.textContent = "正在连接安卓朗读服务，首次使用可能需要几秒钟。";
  } else {
    elements.ttsStatusText.textContent = "朗读服务暂不可用，可打开系统朗读设置检查英文语音包。";
  }
}

function stopSpeech() {
  speechRunId += 1;
  nativeTtsCleanup?.();
  nativeTtsCleanup = null;
  if (window.AndroidTts?.stop) {
    try {
      window.AndroidTts.stop();
    } catch {
      // Fall through so the browser speech engine is stopped as well.
    }
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  elements.speakButton.classList.remove("speaking");
}

function stopSpeechAndContinuous() {
  continuousPlaying = false;
  stopSpeech();
  updateContinuousButton();
}

function speakText(text, onDone) {
  const hasNativeTts = hasNativeTtsBridge();
  if (!hasNativeTts && !("speechSynthesis" in window)) {
    showToast("当前浏览器不支持自动朗读，请换用 Chrome、Edge 或 Safari。", 3500);
    return;
  }
  const content = String(text || "").trim();
  if (!content) {
    showToast("当前条目没有可朗读的英文内容");
    return;
  }

  stopSpeech();
  const runId = speechRunId;
  const repeat = Math.max(1, Math.min(3, Number(state.settings.repeat) || 1));
  let completed = 0;
  elements.speakButton.classList.add("speaking");

  if (hasNativeTts) {
    const requestId = `native-${runId}-${Date.now()}`;
    const cleanupNativeListeners = () => {
      window.removeEventListener("native-tts-done", handleDone);
      window.removeEventListener("native-tts-error", handleError);
      if (nativeTtsCleanup === cleanupNativeListeners) nativeTtsCleanup = null;
    };
    const handleDone = (event) => {
      if (event.detail?.id !== requestId) return;
      cleanupNativeListeners();
      if (runId !== speechRunId) return;
      elements.speakButton.classList.remove("speaking");
      onDone?.();
    };
    const handleError = (event) => {
      if (event.detail?.id !== requestId) return;
      cleanupNativeListeners();
      if (runId !== speechRunId) return;
      elements.speakButton.classList.remove("speaking");
      updateTtsStatus();
      showToast("朗读没有成功，请到设置中检查系统朗读服务和英文语音包。", 4500);
    };
    window.addEventListener("native-tts-done", handleDone);
    window.addEventListener("native-tts-error", handleError);
    nativeTtsCleanup = cleanupNativeListeners;
    try {
      window.AndroidTts.speak(content, Number(state.settings.rate) || 0.85, repeat, requestId);
    } catch {
      handleError({ detail: { id: requestId } });
    }
    return;
  }

  const speakOnce = () => {
    if (runId !== speechRunId) return;
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = "en-US";
    utterance.rate = Number(state.settings.rate) || 0.85;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (runId !== speechRunId) return;
      completed += 1;
      if (completed < repeat) {
        window.setTimeout(speakOnce, 260);
      } else {
        elements.speakButton.classList.remove("speaking");
        onDone?.();
      }
    };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      elements.speakButton.classList.remove("speaking");
      showToast("朗读没有成功，请检查设备的语音设置。", 3200);
    };
    speechSynthesis.speak(utterance);
  };

  speakOnce();
}

function speakCurrent(onDone) {
  const item = getCurrentItem();
  if (!item) return;
  speakText(item.answer || item.prompt, onDone);
}

function updateContinuousButton() {
  elements.continuousPlayButton?.classList.toggle("playing", continuousPlaying);
  if (!elements.continuousPlayButton) return;
  elements.continuousPlayButton.innerHTML = continuousPlaying
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/></svg>停止朗读'
    : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 6 10 6-10 6V6Z"/></svg>连续朗读';
}

function playContinuousItem() {
  if (!continuousPlaying || !session) return;
  session.revealed = true;
  renderStudy();
  speakCurrent(() => {
    if (!continuousPlaying || !session) return;
    if (session.index >= session.itemIds.length - 1) {
      stopSpeechAndContinuous();
      showToast("整份作业朗读完毕");
      return;
    }
    session.index += 1;
    session.revealed = true;
    renderStudy();
    window.setTimeout(playContinuousItem, 420);
  });
}

function toggleContinuousPlay() {
  if (continuousPlaying) {
    stopSpeechAndContinuous();
    return;
  }
  continuousPlaying = true;
  updateContinuousButton();
  playContinuousItem();
}

function populateVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
  const current = elements.voiceSelect.value || state.settings.voiceURI;
  elements.voiceSelect.innerHTML = '<option value="">系统推荐英语声音</option>' + voices
    .map((voice) => `<option value="${escapeHtml(voice.voiceURI)}">${escapeHtml(voice.name)}（${escapeHtml(voice.lang)}）</option>`)
    .join("");
  elements.voiceSelect.value = voices.some((voice) => voice.voiceURI === current) ? current : "";
}

function openImportDialog() {
  parsedImportItems = [];
  importFileFormat = "auto";
  selectedPhotoFile = null;
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = "";
  elements.importForm.reset();
  elements.assignmentTitleInput.value = getDefaultTitle();
  elements.selectedFileName.textContent = "文件内容只在你的浏览器中处理";
  elements.photoPreviewWrap.hidden = true;
  elements.ocrButton.disabled = true;
  elements.ocrProgress.hidden = true;
  elements.importPreview.hidden = true;
  elements.importError.hidden = true;
  switchImportTab("paste");
  elements.importDialog.showModal();
  window.setTimeout(() => elements.assignmentTitleInput.focus(), 80);
}

function switchImportTab(tabName) {
  $$('[data-import-tab]').forEach((button) => {
    const active = button.dataset.importTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-import-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.importPanel !== tabName;
  });
}

function getParseOptions() {
  return {
    format: importFileFormat,
    splitMode: elements.paragraphSplitInput.checked ? "paragraph" : "line",
  };
}

function parseImportPreview() {
  elements.importError.hidden = true;
  try {
    parsedImportItems = deduplicateItems(parseImportedContent(elements.contentInput.value, getParseOptions()));
  } catch (error) {
    elements.importError.textContent = error.message || "内容解析失败，请检查格式。";
    elements.importError.hidden = false;
    elements.importPreview.hidden = true;
    return [];
  }

  if (!parsedImportItems.length) {
    elements.importError.textContent = "没有识别到可用内容。请粘贴或输入至少一条背诵内容。";
    elements.importError.hidden = false;
    elements.importPreview.hidden = true;
    return [];
  }

  const missingAnswers = parsedImportItems.filter((item) => !item.answer).length;
  elements.previewHeading.textContent = `识别到 ${parsedImportItems.length} 条${missingAnswers ? `，${missingAnswers} 条缺少英文` : ""}`;
  elements.previewList.innerHTML = parsedImportItems.slice(0, 40).map((item, index) => `
    <div class="preview-row">
      <span>${index + 1}</span>
      <span>${escapeHtml(item.prompt || "（无中文提示）")}</span>
      <span class="english">${escapeHtml(item.answer || "（请补充英文）")}</span>
    </div>`).join("") + (parsedImportItems.length > 40 ? '<div class="preview-row"><span>…</span><span>其余内容已省略预览</span><span></span></div>' : "");
  elements.importPreview.hidden = false;
  return parsedImportItems;
}

async function readContentFile(file) {
  if (!file) return;
  const extension = file.name.split(".").pop()?.toLowerCase();
  importFileFormat = extension === "csv" ? "csv" : extension === "tsv" ? "tsv" : extension === "json" ? "json" : "auto";
  try {
    elements.contentInput.value = await file.text();
    elements.selectedFileName.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    parseImportPreview();
  } catch {
    elements.importError.textContent = "无法读取这个文件，请换用 UTF-8 编码的文本文件。";
    elements.importError.hidden = false;
  }
}

function handlePhotoSelection(file) {
  selectedPhotoFile = file || null;
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = file ? URL.createObjectURL(file) : "";
  elements.photoPreviewWrap.hidden = !file;
  elements.ocrButton.disabled = !file;
  if (file) elements.photoPreview.src = photoObjectUrl;
}

function loadOcrLibrary() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${OCR_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Tesseract), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = OCR_SCRIPT_URL;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("识别组件下载失败"));
    document.head.append(script);
  });
}

function updateOcrProgress(message = {}) {
  const percent = Math.round((Number(message.progress) || 0) * 100);
  const labels = {
    "loading tesseract core": "正在加载识别引擎",
    "initializing tesseract": "正在初始化识别引擎",
    "loading language traineddata": "正在下载中英文识别数据",
    "initializing api": "正在准备中英文识别",
    "recognizing text": "正在识别图片文字",
  };
  elements.ocrProgressBar.style.width = `${percent}%`;
  elements.ocrProgressText.textContent = `${labels[message.status] || "正在处理图片"}${percent ? ` ${percent}%` : "…"}`;
}

async function recognizePhoto() {
  if (!selectedPhotoFile) return;
  elements.ocrButton.disabled = true;
  elements.ocrProgress.hidden = false;
  elements.ocrProgressBar.style.width = "2%";
  elements.ocrProgressText.textContent = "正在下载识别组件…";
  elements.importError.hidden = true;
  try {
    const tesseract = await loadOcrLibrary();
    const result = await tesseract.recognize(selectedPhotoFile, "eng+chi_sim", {
      logger: updateOcrProgress,
    });
    elements.contentInput.value = result.data.text.trim();
    importFileFormat = "auto";
    elements.ocrProgressBar.style.width = "100%";
    elements.ocrProgressText.textContent = "识别完成，请校对下方文字";
    parseImportPreview();
    elements.contentInput.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    elements.importError.textContent = "图片识别没有成功。请检查网络后重试，或直接在下方粘贴文字。";
    elements.importError.hidden = false;
    elements.ocrProgressText.textContent = "识别失败";
  } finally {
    elements.ocrButton.disabled = false;
  }
}

function saveImportedAssignment(event) {
  event.preventDefault();
  const title = elements.assignmentTitleInput.value.trim();
  if (!title) {
    elements.assignmentTitleInput.focus();
    return;
  }
  const items = parseImportPreview();
  if (!items.length) return;

  const now = new Date().toISOString();
  const assignment = normalizeAssignment({
    id: createId("assignment"),
    title,
    type: elements.assignmentTypeInput.value,
    createdAt: now,
    updatedAt: now,
    items: items.map(createImportedItem),
  });
  state.assignments.unshift(assignment);
  state.activeAssignmentId = assignment.id;
  saveState();
  elements.importDialog.close();
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = "";
  renderAll();
  showToast(`已保存 ${assignment.items.length} 条背诵内容`);
  startStudy("all", assignment.id);
}

function openEditItemDialog() {
  const item = getCurrentItem();
  if (!item) return;
  elements.editPromptInput.value = item.prompt;
  elements.editAnswerInput.value = item.answer;
  elements.editNoteInput.value = item.note;
  elements.editItemDialog.showModal();
}

function saveEditedItem(event) {
  event.preventDefault();
  const item = getCurrentItem();
  const assignment = getSessionAssignment();
  if (!item || !assignment) return;
  const answer = elements.editAnswerInput.value.trim();
  if (!answer) {
    elements.editAnswerInput.focus();
    return;
  }
  item.prompt = elements.editPromptInput.value.trim();
  item.answer = answer;
  item.note = elements.editNoteInput.value.trim();
  assignment.updatedAt = new Date().toISOString();
  saveState();
  elements.editItemDialog.close();
  renderStudy();
  renderAll();
  showToast("内容已修改");
}

function deleteCurrentItem() {
  const item = getCurrentItem();
  const assignment = getSessionAssignment();
  if (!item || !assignment) return;
  if (!window.confirm("确定删除当前这一条背诵内容吗？")) return;
  assignment.items = assignment.items.filter((candidate) => candidate.id !== item.id);
  session.itemIds = session.itemIds.filter((id) => id !== item.id);
  if (session.index >= session.itemIds.length) session.index = Math.max(0, session.itemIds.length - 1);
  assignment.updatedAt = new Date().toISOString();
  saveState();
  elements.editItemDialog.close();
  renderAll();
  if (!session.itemIds.length) finishSession();
  else renderStudy();
}

function downloadJson(data, filename) {
  const safeFilename = filename.replace(/[\\/:*?"<>|]/g, "-");
  if (window.AndroidFiles?.saveJson) {
    try {
      window.AndroidFiles.saveJson(safeFilename, JSON.stringify(data, null, 2));
      return;
    } catch {
      showToast("无法打开保存位置，请稍后重试。", 3200);
      return;
    }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function handleAssignmentAction(action, id) {
  const assignment = state.assignments.find((item) => item.id === id);
  if (!assignment) return;
  if (action === "start" || action === "focus") {
    startStudy(action === "focus" ? "focus" : "all", id);
    return;
  }
  if (action === "export") {
    downloadJson({ version: 1, ...assignment }, `${assignment.title}.json`);
    showToast("已导出这份作业");
    return;
  }
  if (action === "delete") {
    if (!window.confirm(`确定删除“${assignment.title}”吗？这份作业的背诵进度也会删除。`)) return;
    state.assignments = state.assignments.filter((item) => item.id !== id);
    if (state.activeAssignmentId === id) state.activeAssignmentId = state.assignments[0]?.id || null;
    saveState();
    renderAll();
    showToast("作业已删除");
  }
}

function openSettings() {
  populateVoices();
  updateTtsStatus();
  elements.voiceSelect.value = state.settings.voiceURI || "";
  elements.rateSelect.value = String(state.settings.rate);
  elements.repeatSelect.value = String(state.settings.repeat);
  elements.autoSpeakInput.checked = Boolean(state.settings.autoSpeak);
  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();
  state.settings.voiceURI = elements.voiceSelect.value;
  state.settings.rate = Number(elements.rateSelect.value);
  state.settings.repeat = Number(elements.repeatSelect.value);
  state.settings.autoSpeak = elements.autoSpeakInput.checked;
  saveState();
  elements.settingsDialog.close();
  showToast("设置已保存");
}

function exportBackup() {
  downloadJson({ ...state, exportedAt: new Date().toISOString() }, `英语背诵助手备份-${getDefaultTitle().replace("英语背诵", "")}.json`);
  showToast("全部作业和进度已导出");
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.assignments)) throw new Error("invalid");
    if (!window.confirm(`备份中有 ${parsed.assignments.length} 份作业。恢复后将替换当前数据，是否继续？`)) return;
    const base = defaultState();
    const assignments = parsed.assignments.map(normalizeAssignment);
    state = {
      ...base,
      ...parsed,
      assignments,
      activeAssignmentId: assignments.some((item) => item.id === parsed.activeAssignmentId)
        ? parsed.activeAssignmentId
        : assignments[0]?.id || null,
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
    saveState();
    renderAll();
    elements.settingsDialog.close();
    showView("home");
    showToast("备份已恢复");
  } catch {
    showToast("这不是有效的英语背诵助手备份文件。", 3500);
  } finally {
    elements.backupFileInput.value = "";
  }
}

function closeDialogById(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view-target]");
    if (viewButton) {
      showView(viewButton.dataset.viewTarget);
      return;
    }
    const importButton = event.target.closest('[data-action="import"]');
    if (importButton) {
      openImportDialog();
      return;
    }
    const assignmentButton = event.target.closest("[data-select-assignment]");
    if (assignmentButton) {
      setActiveAssignment(assignmentButton.dataset.selectAssignment);
      showView("home");
      return;
    }
    const assignmentAction = event.target.closest("[data-assignment-action]");
    if (assignmentAction) {
      handleAssignmentAction(assignmentAction.dataset.assignmentAction, assignmentAction.dataset.assignmentId);
      return;
    }
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) {
      closeDialogById(closeButton.dataset.closeDialog);
      return;
    }
    if (event.target.closest("[data-close-completion]")) {
      elements.completionDialog.close();
      showView("home");
    }
  });

  elements.startStudyButton.addEventListener("click", () => startStudy("all"));
  elements.focusStudyButton.addEventListener("click", () => startStudy("focus"));
  elements.loadDemoButton.addEventListener("click", addDemoAssignment);
  elements.answerPanel.addEventListener("click", revealAnswer);
  elements.speakButton.addEventListener("click", () => speakCurrent());
  elements.previousItemButton.addEventListener("click", () => moveItem(-1));
  elements.nextItemButton.addEventListener("click", () => moveItem(1));
  elements.continuousPlayButton.addEventListener("click", toggleContinuousPlay);
  elements.editItemButton.addEventListener("click", openEditItemDialog);
  $$(".status-button").forEach((button) => button.addEventListener("click", () => markCurrentItem(button.dataset.status)));

  elements.studyModeSelect.addEventListener("change", () => {
    stopSpeechAndContinuous();
    session.mode = elements.studyModeSelect.value;
    session.revealed = session.mode === "follow";
    renderStudy();
    if (session.mode === "follow" && state.settings.autoSpeak) speakCurrent();
  });

  $$('[data-import-tab]').forEach((button) => button.addEventListener("click", () => switchImportTab(button.dataset.importTab)));
  elements.contentFileInput.addEventListener("change", () => readContentFile(elements.contentFileInput.files[0]));
  elements.photoFileInput.addEventListener("change", () => handlePhotoSelection(elements.photoFileInput.files[0]));
  elements.ocrButton.addEventListener("click", recognizePhoto);
  elements.previewImportButton.addEventListener("click", parseImportPreview);
  elements.importForm.addEventListener("submit", saveImportedAssignment);
  elements.assignmentTypeInput.addEventListener("change", () => {
    if (elements.assignmentTypeInput.value === "text") elements.paragraphSplitInput.checked = true;
  });

  elements.editItemForm.addEventListener("submit", saveEditedItem);
  elements.deleteItemButton.addEventListener("click", deleteCurrentItem);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.testSpeechButton.addEventListener("click", () => {
    speakText("This is a test of English reading.", () => {
      updateTtsStatus();
      showToast("测试朗读完成");
    });
  });
  elements.ttsSettingsButton.addEventListener("click", () => {
    try {
      window.AndroidTts?.openSettings?.();
    } catch {
      showToast("未能打开系统朗读设置，请在手机设置中搜索“文字转语音输出”。", 4200);
    }
  });
  elements.exportBackupButton.addEventListener("click", exportBackup);
  elements.backupFileInput.addEventListener("change", () => restoreBackup(elements.backupFileInput.files[0]));
  elements.reviewAgainButton.addEventListener("click", () => {
    const assignmentId = session?.assignmentId || state.activeAssignmentId;
    elements.completionDialog.close();
    startStudy("focus", assignmentId);
  });

  elements.importDialog.addEventListener("close", () => {
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = "";
  });

  document.addEventListener("keydown", (event) => {
    if (currentView !== "study" || $("dialog[open]") || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    if (event.key === "ArrowLeft") moveItem(-1);
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      if (!session.revealed) revealAnswer();
      else moveItem(1);
    }
    if (event.key === "1") markCurrentItem(STATUS.UNKNOWN);
    if (event.key === "2") markCurrentItem(STATUS.FUZZY);
    if (event.key === "3") markCurrentItem(STATUS.MASTERED);
  });

  if ("speechSynthesis" in window) {
    populateVoices();
    speechSynthesis.addEventListener?.("voiceschanged", populateVoices);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
    showToast("英语背诵助手已安装");
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The app remains fully usable online even if service worker registration fails.
    });
  }
}

bindEvents();
renderAll();
showView("home");
registerServiceWorker();
