import {
  STATUS,
  buildCue,
  buildStudyEntries,
  buildSpeechSegments,
  deduplicateItems,
  isMandarinVoice,
  parseImportedContent,
  reviewedToday,
  summarize,
} from "./core.js";
import { deleteAudio, deleteAudios, getAudio, saveAudio } from "./audio-store.js";

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
  studyScopeSelect: $("#studyScopeSelect"),
  studyStatusFilter: $("#studyStatusFilter"),
  applyStudyFilterButton: $("#applyStudyFilterButton"),
  studyModeSelect: $("#studyModeSelect"),
  studyProgressBar: $("#studyProgressBar"),
  currentStatusPill: $("#currentStatusPill"),
  audioSourceBadge: $("#audioSourceBadge"),
  promptLabel: $("#promptLabel"),
  speakPromptButton: $("#speakPromptButton"),
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
  insertExampleButton: $("#insertExampleButton"),
  saveAssignmentButton: $("#saveAssignmentButton"),
  paragraphSplitInput: $("#paragraphSplitInput"),
  contentFileInput: $("#contentFileInput"),
  assignmentAudioInput: $("#assignmentAudioInput"),
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
  editAudioInput: $("#editAudioInput"),
  editAudioName: $("#editAudioName"),
  removeEditAudioButton: $("#removeEditAudioButton"),
  deleteItemButton: $("#deleteItemButton"),
  editAssignmentDialog: $("#editAssignmentDialog"),
  editAssignmentForm: $("#editAssignmentForm"),
  editAssignmentTitleInput: $("#editAssignmentTitleInput"),
  editAssignmentTypeInput: $("#editAssignmentTypeInput"),
  editAssignmentAudioInput: $("#editAssignmentAudioInput"),
  editAssignmentAudioName: $("#editAssignmentAudioName"),
  removeAssignmentAudioButton: $("#removeAssignmentAudioButton"),
  addBulkItemButton: $("#addBulkItemButton"),
  bulkEditList: $("#bulkEditList"),
  saveAssignmentEditButton: $("#saveAssignmentEditButton"),
  settingsButton: $("#settingsButton"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  voiceSelect: $("#voiceSelect"),
  chineseVoiceSelect: $("#chineseVoiceSelect"),
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
    version: 2,
    activeAssignmentId: null,
    assignments: [],
    settings: {
      voiceURI: "",
      chineseVoiceURI: "",
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
    audio: normalizeAudioMetadata(item.audio),
  };
}

function normalizeAudioMetadata(audio) {
  if (!audio || !audio.name) return null;
  return {
    name: String(audio.name),
    type: String(audio.type || "audio/mpeg"),
    size: Number(audio.size) || 0,
    updatedAt: audio.updatedAt || null,
  };
}

function normalizeAssignment(assignment) {
  return {
    id: assignment.id || createId("assignment"),
    title: String(assignment.title || "未命名背诵作业").trim(),
    type: TYPE_LABELS[assignment.type] ? assignment.type : "mixed",
    createdAt: assignment.createdAt || new Date().toISOString(),
    updatedAt: assignment.updatedAt || assignment.createdAt || new Date().toISOString(),
    audio: normalizeAudioMetadata(assignment.audio),
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
      version: 2,
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
let importPreviewSignature = "";
let importFileFormat = "auto";
let selectedPhotoFile = null;
let photoObjectUrl = "";
let toastTimer = null;
let saveTimer = null;
let speechRunId = 0;
let continuousPlaying = false;
let nativeTtsCleanup = null;
let activeAudio = null;
let activeAudioUrl = "";
let editAudioRemoveRequested = false;
let bulkEditAssignmentId = null;
let bulkDraftItems = [];
let bulkAssignmentAudioRemoveRequested = false;
let deferredInstallPrompt = null;
let markAdvanceTimer = null;

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

const MAX_AUDIO_SIZE = 40 * 1024 * 1024;

function itemAudioKey(itemId) {
  return `item:${itemId}`;
}

function assignmentAudioKey(assignmentId) {
  return `assignment:${assignmentId}`;
}

function formatFileSize(size = 0) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function validateMp3File(file) {
  if (!file) return "";
  const isMp3 = /\.mp3$/i.test(file.name) || file.type === "audio/mpeg" || file.type === "audio/mp3";
  if (!isMp3) return "请选择 MP3 格式的音频文件。";
  if (file.size > MAX_AUDIO_SIZE) return "单个 MP3 请不要超过 40 MB。";
  return "";
}

async function storeMp3(key, file) {
  const error = validateMp3File(file);
  if (error) throw new Error(error);
  const metadata = await saveAudio(key, file);
  const persistenceRequest = navigator.storage?.persist?.();
  persistenceRequest?.catch(() => {});
  return metadata;
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
    .map((assignment, assignmentIndex) => {
      const summary = summarize(assignment.items);
      const focusCount = summary.unknown + summary.fuzzy;
      const itemAudioCount = assignment.items.filter((item) => item.audio).length;
      const audioCount = itemAudioCount + (assignment.audio ? 1 : 0);
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
              ${audioCount ? `<span>已配 ${audioCount} 个 MP3</span>` : ""}
            </div>
            <div class="mini-progress" aria-label="已掌握 ${summary.mastery}%"><span style="width:${summary.mastery}%"></span></div>
          </div>
          <div class="library-card-actions">
            <button class="button button-secondary" type="button" data-assignment-action="focus" data-assignment-id="${escapeHtml(assignment.id)}" ${focusCount ? "" : "disabled"}>重点复习</button>
            <button class="button button-primary" type="button" data-assignment-action="start" data-assignment-id="${escapeHtml(assignment.id)}">开始背诵</button>
            <button class="button button-secondary" type="button" data-assignment-action="edit" data-assignment-id="${escapeHtml(assignment.id)}">整体编辑</button>
            <details class="assignment-more"><summary class="button button-quiet">更多 ▾</summary><div class="assignment-more-actions">
            <button class="button button-quiet menu-button" type="button" data-assignment-action="move-up" data-assignment-id="${escapeHtml(assignment.id)}" ${assignmentIndex === 0 ? "disabled" : ""}>↑ 上移</button>
            <button class="button button-quiet menu-button" type="button" data-assignment-action="move-down" data-assignment-id="${escapeHtml(assignment.id)}" ${assignmentIndex === state.assignments.length - 1 ? "disabled" : ""}>↓ 下移</button>
            <button class="button button-quiet menu-button" type="button" data-assignment-action="export" data-assignment-id="${escapeHtml(assignment.id)}" title="导出这一份作业">导出</button>
            <button class="button button-quiet menu-button danger-text" type="button" data-assignment-action="delete" data-assignment-id="${escapeHtml(assignment.id)}" title="删除作业">删除</button>
            </div></details>
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

function assignmentsForScope(scope) {
  if (scope === "all") return state.assignments;
  const assignment = state.assignments.find((item) => item.id === scope);
  return assignment ? [assignment] : [];
}

function sessionEntriesFor(scope, filter) {
  return buildStudyEntries(state.assignments, scope, filter);
}

function populateStudyFilters(scope = session?.scope || state.activeAssignmentId || "all", filter = session?.filter || "all") {
  elements.studyScopeSelect.innerHTML = '<option value="all">所有作业本</option>' + state.assignments
    .map((assignment) => `<option value="${escapeHtml(assignment.id)}">${escapeHtml(assignment.title)}</option>`)
    .join("");
  elements.studyScopeSelect.value = scope === "all" || state.assignments.some((item) => item.id === scope)
    ? scope
    : "all";
  elements.studyStatusFilter.value = ["all", "unknown", "fuzzy", "focus"].includes(filter) ? filter : "all";
}

function startStudy(filter = "all", scope = state.activeAssignmentId) {
  if (!state.assignments.length) {
    showToast("请先添加一份背诵作业");
    return;
  }
  const normalizedScope = scope === "all" || state.assignments.some((item) => item.id === scope)
    ? scope
    : state.activeAssignmentId || "all";
  const entries = sessionEntriesFor(normalizedScope, filter);
  if (!entries.length) {
    const scopeLabel = normalizedScope === "all" ? "所有作业本" : "这份作业本";
    showToast(`${scopeLabel}中没有符合当前类别的内容`);
    return;
  }

  if (normalizedScope !== "all") {
    state.activeAssignmentId = normalizedScope;
    saveState();
  }
  const sessionItems = entries.map((entry) => {
    const assignment = state.assignments.find((item) => item.id === entry.assignmentId);
    return assignment?.items.find((item) => item.id === entry.itemId);
  }).filter(Boolean);
  const withoutPrompt = sessionItems.filter((item) => !item.prompt).length;
  const allText = assignmentsForScope(normalizedScope).every((assignment) => assignment.type === "text");
  const mode = allText || withoutPrompt > sessionItems.length / 2 ? "follow" : "recall";
  session = {
    scope: normalizedScope,
    filter,
    entries,
    index: 0,
    mode,
    revealed: mode === "follow",
  };
  populateStudyFilters(normalizedScope, filter);
  elements.studyModeSelect.value = mode;
  showView("study");
  renderStudy();

  if (mode === "follow" && state.settings.autoSpeak) {
    speakCurrent();
  }
}

function getSessionEntry() {
  return session?.entries?.[session.index] || null;
}

function getSessionAssignment() {
  const entry = getSessionEntry();
  return state.assignments.find((assignment) => assignment.id === entry?.assignmentId) || null;
}

function getCurrentItem() {
  const assignment = getSessionAssignment();
  const entry = getSessionEntry();
  return assignment?.items.find((item) => item.id === entry?.itemId) || null;
}

function getSessionItems() {
  return (session?.entries || []).map((entry) => {
    const assignment = state.assignments.find((item) => item.id === entry.assignmentId);
    return assignment?.items.find((item) => item.id === entry.itemId);
  }).filter(Boolean);
}

function renderStudy() {
  const assignment = getSessionAssignment();
  const item = getCurrentItem();
  if (!assignment || !item) {
    finishSession();
    return;
  }

  const count = session.entries.length;
  const position = session.index + 1;
  elements.studyAssignmentTitle.textContent = session.scope === "all"
    ? `全部作业 · ${assignment.title}`
    : assignment.title;
  elements.studyCounter.textContent = `${position} / ${count}`;
  elements.studyProgressBar.style.width = `${(position / count) * 100}%`;
  elements.studyModeSelect.value = session.mode;
  populateStudyFilters(session.scope, session.filter);

  elements.currentStatusPill.textContent = STATUS_LABELS[item.status] || STATUS_LABELS[STATUS.NEW];
  elements.currentStatusPill.className = `status-pill status-${item.status || STATUS.NEW}`;
  elements.audioSourceBadge.hidden = !item.audio;
  elements.speakPromptButton.hidden = !item.prompt;
  elements.speakButton.querySelector("span").textContent = item.audio ? "播放 MP3" : "朗读";
  elements.speakButton.setAttribute("aria-label", item.audio ? "播放当前内容的 MP3" : "朗读当前内容");
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
  if (markAdvanceTimer !== null) return;
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
  markAdvanceTimer = window.setTimeout(() => {
    markAdvanceTimer = null;
    moveItem(1);
  }, 250);
}

function moveItem(direction) {
  if (!session) return;
  stopSpeechAndContinuous();
  const nextIndex = session.index + direction;
  if (nextIndex < 0) return;
  if (nextIndex >= session.entries.length) {
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
  if (!session?.entries?.length) {
    showView("home");
    return;
  }
  const summary = summarize(getSessionItems());
  elements.completionSummary.textContent = `本轮 ${summary.total} 项：已掌握 ${summary.mastered} 项，模糊 ${summary.fuzzy} 项，不认识 ${summary.unknown} 项。`;
  elements.reviewAgainButton.hidden = summary.fuzzy + summary.unknown === 0;
  renderAll();
  elements.completionDialog.showModal();
}

function chooseVoice(language = "en-US", settings = state.settings) {
  const voices = speechSynthesis.getVoices();
  const candidates = voices.filter((voice) => language.startsWith("zh")
    ? isMandarinVoice(voice)
    : /^en[-_]/i.test(voice.lang));
  const selectedId = language.startsWith("zh") ? settings.chineseVoiceURI : settings.voiceURI;
  const selected = candidates.find((voice) => voice.voiceURI === selectedId);
  if (selected) return selected;
  if (language.startsWith("zh")) {
    return candidates.find((voice) => /普通话|Mandarin|Xiaoxiao|Google.*中文/i.test(voice.name))
      || candidates.find((voice) => /^zh[-_](CN|Hans)/i.test(voice.lang))
      || candidates[0]
      || null;
  }
  return candidates.find((voice) => /Samantha|Google US English|Microsoft.*English/i.test(voice.name))
    || candidates.find((voice) => /^en[-_]US/i.test(voice.lang))
    || candidates[0]
    || null;
}

function hasNativeTtsBridge() {
  return typeof window.AndroidTts?.speakLocalized === "function" || typeof window.AndroidTts?.speak === "function";
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
    elements.ttsStatusText.textContent = "朗读服务暂不可用，可打开系统朗读设置检查中英文语音包。";
  }
}

function cleanupActiveAudio() {
  const audio = activeAudio;
  activeAudio = null;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = "";
}

function stopSpeech() {
  speechRunId += 1;
  cleanupActiveAudio();
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
  if (markAdvanceTimer !== null) {
    clearTimeout(markAdvanceTimer);
    markAdvanceTimer = null;
  }
  continuousPlaying = false;
  stopSpeech();
  updateContinuousButton();
}

function speakText(text, onDone, options = {}) {
  const hasNativeTts = hasNativeTtsBridge();
  if (!hasNativeTts && !("speechSynthesis" in window)) {
    showToast("当前浏览器不支持自动朗读，请换用 Chrome、Edge 或 Safari。", 3500);
    return;
  }
  const content = String(text || "").trim();
  if (!content) {
    showToast("当前条目没有可朗读内容");
    return;
  }

  stopSpeech();
  const runId = speechRunId;
  const settings = { ...state.settings, ...options };
  const segments = buildSpeechSegments(content);
  const repeat = Math.max(1, Math.min(3, Number(settings.repeat) || 1));
  let step = 0;
  elements.speakButton.classList.add("speaking");
  const fail = () => {
    if (runId !== speechRunId) return;
    stopSpeechAndContinuous();
    updateTtsStatus();
    showToast("朗读未成功，请在设置中试听其他声音，或检查普通话/英语语音包。", 4500);
  };
  const next = () => {
    if (runId !== speechRunId) return;
    if (step >= segments.length * repeat) {
      elements.speakButton.classList.remove("speaking");
      onDone?.();
      return;
    }
    const { text: part, language } = segments[step % segments.length];
    // Chinese uses natural speed; the user's slower study rate applies to English/MP3.
    const rate = language === "zh-CN" ? 1 : Number(settings.rate) || 0.85;
    const done = () => {
      if (runId !== speechRunId) return;
      step += 1;
      if (step >= segments.length * repeat) {
        elements.speakButton.classList.remove("speaking");
        onDone?.();
      } else {
        window.setTimeout(next, step % segments.length === 0 ? 400 : 60);
      }
    };
    if (hasNativeTts) {
      const requestId = `native-${runId}-${step}-${Date.now()}`;
      const cleanup = () => {
        window.removeEventListener("native-tts-done", handleDone);
        window.removeEventListener("native-tts-error", handleError);
        if (nativeTtsCleanup === cleanup) nativeTtsCleanup = null;
      };
      const handleDone = (event) => {
        if (event.detail?.id !== requestId) return;
        cleanup();
        done();
      };
      const handleError = (event) => {
        if (event.detail?.id !== requestId) return;
        cleanup();
        fail();
      };
      window.addEventListener("native-tts-done", handleDone);
      window.addEventListener("native-tts-error", handleError);
      nativeTtsCleanup = cleanup;
      try {
        if (typeof window.AndroidTts.speakWithVoice === "function") {
          const voiceId = language === "zh-CN" ? settings.chineseVoiceURI : settings.voiceURI;
          window.AndroidTts.speakWithVoice(part, language, rate, 1, requestId, voiceId || "");
        } else if (typeof window.AndroidTts.speakLocalized === "function") {
          window.AndroidTts.speakLocalized(part, language, rate, 1, requestId);
        } else {
          window.AndroidTts.speak(part, rate, 1, requestId);
        }
      } catch {
        handleError({ detail: { id: requestId } });
      }
      return;
    }
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.lang = language;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = chooseVoice(language, settings);
    if (voice) utterance.voice = voice;
    utterance.onend = done;
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      fail();
    };
    speechSynthesis.speak(utterance);
  };
  next();
}

async function playStoredAudio(storageKey, options = {}) {
  stopSpeech();
  const runId = speechRunId;
  const repeat = Math.max(1, Math.min(3, Number(options.repeat) || 1));
  let completed = 0;
  let failed = false;
  elements.speakButton.classList.add("speaking");

  const fallBack = () => {
    if (failed || runId !== speechRunId) return;
    failed = true;
    cleanupActiveAudio();
    elements.speakButton.classList.remove("speaking");
    options.onFallback?.();
  };

  try {
    const record = await getAudio(storageKey);
    if (runId !== speechRunId) return;
    if (!record?.blob) {
      fallBack();
      return;
    }

    activeAudioUrl = URL.createObjectURL(record.blob);
    const audio = new Audio(activeAudioUrl);
    activeAudio = audio;
    audio.preload = "auto";
    audio.playbackRate = Math.max(0.5, Math.min(2, Number(state.settings.rate) || 1));
    audio.onended = () => {
      if (runId !== speechRunId) return;
      completed += 1;
      if (completed < repeat) {
        audio.currentTime = 0;
        audio.play().catch(fallBack);
        return;
      }
      cleanupActiveAudio();
      elements.speakButton.classList.remove("speaking");
      options.onDone?.();
    };
    audio.onerror = fallBack;
    await audio.play();
  } catch {
    fallBack();
  }
}

function speakCurrent(onDone) {
  const item = getCurrentItem();
  if (!item) return;
  const text = item.answer || item.prompt;
  if (item.audio) {
    playStoredAudio(itemAudioKey(item.id), {
      repeat: state.settings.repeat,
      onDone,
      onFallback: () => {
        item.audio = null;
        saveState();
        renderStudy();
        showToast("已上传的 MP3 无法读取，已改用自动朗读。", 3200);
        speakText(text, onDone);
      },
    });
    return;
  }
  speakText(text, onDone);
}

function canUseWholeAssignmentAudio() {
  if (!session || session.scope === "all" || session.filter !== "all") return false;
  return Boolean(assignmentsForScope(session.scope)[0]?.audio);
}

function updateContinuousButton() {
  elements.continuousPlayButton?.classList.toggle("playing", continuousPlaying);
  if (!elements.continuousPlayButton) return;
  elements.continuousPlayButton.innerHTML = continuousPlaying
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/></svg>停止朗读'
    : canUseWholeAssignmentAudio()
      ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 6 10 6-10 6V6Z"/></svg>播放整份 MP3'
      : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 6 10 6-10 6V6Z"/></svg>连续朗读';
}

function playContinuousItem() {
  if (!continuousPlaying || !session) return;
  session.revealed = true;
  renderStudy();
  speakCurrent(() => {
    if (!continuousPlaying || !session) return;
    if (session.index >= session.entries.length - 1) {
      stopSpeechAndContinuous();
      showToast(session.scope === "all" ? "所选内容朗读完毕" : "整份作业朗读完毕");
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
  if (canUseWholeAssignmentAudio()) {
    const assignment = assignmentsForScope(session.scope)[0];
    session.revealed = true;
    renderStudy();
    playStoredAudio(assignmentAudioKey(assignment.id), {
      repeat: 1,
      onDone: () => {
        stopSpeechAndContinuous();
        showToast("整份作业 MP3 播放完毕");
      },
      onFallback: () => {
        assignment.audio = null;
        saveState();
        renderAll();
        showToast("整份 MP3 无法读取，已改为逐条朗读。", 3200);
        playContinuousItem();
      },
    });
    return;
  }
  playContinuousItem();
}

function populateVoices() {
  for (const language of ["zh-CN", "en-US"]) {
    const chinese = language === "zh-CN";
    const select = chinese ? elements.chineseVoiceSelect : elements.voiceSelect;
    const current = elements.settingsDialog.open ? select.value
      : chinese ? state.settings.chineseVoiceURI : state.settings.voiceURI;
    let voices = [];
    const native = typeof window.AndroidTts?.getVoices === "function";
    try {
      voices = native ? JSON.parse(window.AndroidTts.getVoices(language))
        : "speechSynthesis" in window ? speechSynthesis.getVoices().map((voice) => ({
          id: voice.voiceURI, name: voice.name, lang: voice.lang, local: voice.localService,
        })) : [];
    } catch { voices = []; }
    voices = voices.filter((voice) => chinese ? isMandarinVoice(voice) : /^en[-_]/i.test(voice.lang));
    select.innerHTML = `<option value="">${chinese ? "推荐普通话声音" : "推荐英语声音"}</option>` + voices
      .map((voice, index) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(native
        ? `${chinese ? "普通话" : "英语"}声音 ${index + 1} · ${voice.local ? "离线" : "需联网"}${voice.quality >= 400 ? " · 高音质" : ""}`
        : `${voice.name}（${voice.local ? "离线" : "需联网"}）`)}</option>`).join("");
    select.value = voices.some((voice) => voice.id === current) ? current : "";
  }
}

function openImportDialog() {
  parsedImportItems = [];
  importPreviewSignature = "";
  elements.saveAssignmentButton.textContent = "下一步：核对内容";
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

function currentImportSignature() {
  return JSON.stringify([elements.contentInput.value, getParseOptions()]);
}

function invalidateImportPreview() {
  importPreviewSignature = "";
  parsedImportItems = [];
  elements.importPreview.hidden = true;
  elements.importError.hidden = true;
  elements.saveAssignmentButton.textContent = "下一步：核对内容";
}

function parseImportPreview() {
  elements.importError.hidden = true;
  if (importPreviewSignature === currentImportSignature() && parsedImportItems.length) return parsedImportItems;
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
  elements.previewList.innerHTML = parsedImportItems.map((item, index) => `
    <div class="preview-row" data-preview-index="${index}">
      <span class="preview-number">${index + 1}</span>
      <label class="field"><span>【中文】提示（可选）</span><textarea rows="2" data-preview-field="prompt" placeholder="不填也可以">${escapeHtml(item.prompt)}</textarea></label>
      <label class="field"><span>【英文】要背的内容</span><textarea class="english" rows="2" data-preview-field="answer" placeholder="请补充英文">${escapeHtml(item.answer)}</textarea></label>
    </div>`).join("");
  elements.importPreview.hidden = false;
  importPreviewSignature = currentImportSignature();
  elements.saveAssignmentButton.textContent = "确认保存并开始背诵";
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

async function saveImportedAssignment(event) {
  event.preventDefault();
  const title = elements.assignmentTitleInput.value.trim();
  if (!title) {
    elements.assignmentTitleInput.focus();
    return;
  }
  const previewWasCurrent = importPreviewSignature === currentImportSignature() && parsedImportItems.length > 0;
  const items = parseImportPreview();
  if (!items.length) return;
  if (!previewWasCurrent) {
    elements.importPreview.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("请核对下方中英文，可直接修改；确认后再保存。", 3200);
    return;
  }
  const missingIndex = items.findIndex((item) => !item.answer.trim());
  if (missingIndex >= 0) {
    elements.importError.textContent = `第 ${missingIndex + 1} 条缺少英文，请在预览中补充后保存。`;
    elements.importError.hidden = false;
    elements.previewList.querySelector(`[data-preview-index="${missingIndex}"] [data-preview-field="answer"]`)?.focus();
    return;
  }
  const audioFile = elements.assignmentAudioInput.files[0];
  const audioError = validateMp3File(audioFile);
  if (audioError) {
    elements.importError.textContent = audioError;
    elements.importError.hidden = false;
    elements.assignmentAudioInput.focus();
    return;
  }

  const now = new Date().toISOString();
  const assignment = normalizeAssignment({
    id: createId("assignment"),
    title,
    type: elements.assignmentTypeInput.value,
    createdAt: now,
    updatedAt: now,
    items: items.map(createImportedItem),
  });
  if (audioFile) {
    const saveButton = $("#saveAssignmentButton");
    saveButton.disabled = true;
    saveButton.textContent = "正在保存 MP3…";
    try {
      assignment.audio = await storeMp3(assignmentAudioKey(assignment.id), audioFile);
    } catch (error) {
      elements.importError.textContent = error.message || "MP3 保存失败，请重试。";
      elements.importError.hidden = false;
      saveButton.disabled = false;
      saveButton.textContent = "确认保存并开始背诵";
      return;
    }
    saveButton.disabled = false;
    saveButton.textContent = "确认保存并开始背诵";
  }
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
  stopSpeechAndContinuous();
  const item = getCurrentItem();
  if (!item) return;
  elements.editPromptInput.value = item.prompt;
  elements.editAnswerInput.value = item.answer;
  elements.editNoteInput.value = item.note;
  elements.editAudioInput.value = "";
  editAudioRemoveRequested = false;
  elements.editAudioName.textContent = item.audio
    ? `当前：${item.audio.name} · ${formatFileSize(item.audio.size)}`
    : "尚未上传 MP3";
  elements.removeEditAudioButton.hidden = !item.audio;
  elements.editItemDialog.showModal();
}

async function saveEditedItem(event) {
  event.preventDefault();
  const item = getCurrentItem();
  const assignment = getSessionAssignment();
  if (!item || !assignment) return;
  const answer = elements.editAnswerInput.value.trim();
  if (!answer) {
    elements.editAnswerInput.focus();
    return;
  }
  const audioFile = elements.editAudioInput.files[0];
  const audioError = validateMp3File(audioFile);
  if (audioError) {
    showToast(audioError, 3500);
    elements.editAudioInput.focus();
    return;
  }
  const saveButton = elements.editItemForm.querySelector('[type="submit"]');
  saveButton.disabled = true;
  saveButton.textContent = "正在保存…";
  try {
    if (editAudioRemoveRequested) {
      await deleteAudio(itemAudioKey(item.id));
      item.audio = null;
    }
    if (audioFile) {
      item.audio = await storeMp3(itemAudioKey(item.id), audioFile);
    }
  } catch (error) {
    showToast(error.message || "MP3 保存失败，请重试。", 3800);
    saveButton.disabled = false;
    saveButton.textContent = "保存修改";
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
  saveButton.disabled = false;
  saveButton.textContent = "保存修改";
}

function deleteCurrentItem() {
  const item = getCurrentItem();
  const assignment = getSessionAssignment();
  if (!item || !assignment) return;
  if (!window.confirm("确定删除当前这一条背诵内容吗？")) return;
  assignment.items = assignment.items.filter((candidate) => candidate.id !== item.id);
  session.entries = session.entries.filter((entry) => !(entry.assignmentId === assignment.id && entry.itemId === item.id));
  if (session.index >= session.entries.length) session.index = Math.max(0, session.entries.length - 1);
  deleteAudio(itemAudioKey(item.id)).catch(() => {});
  assignment.updatedAt = new Date().toISOString();
  saveState();
  elements.editItemDialog.close();
  renderAll();
  if (!session.entries.length) finishSession();
  else renderStudy();
}

function openEditAssignmentDialog(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  bulkEditAssignmentId = assignment.id;
  bulkDraftItems = assignment.items.map((item) => ({
    ...normalizeItem(item),
    audioFile: null,
    removeAudio: false,
  }));
  bulkAssignmentAudioRemoveRequested = false;
  elements.editAssignmentForm.reset();
  elements.editAssignmentTitleInput.value = assignment.title;
  elements.editAssignmentTypeInput.value = assignment.type;
  elements.editAssignmentAudioName.textContent = assignment.audio
    ? `当前：${assignment.audio.name} · ${formatFileSize(assignment.audio.size)}`
    : "尚未上传整份 MP3";
  elements.removeAssignmentAudioButton.hidden = !assignment.audio;
  renderBulkEditList();
  elements.editAssignmentDialog.showModal();
}

function renderBulkEditList() {
  if (!bulkDraftItems.length) {
    elements.bulkEditList.innerHTML = '<div class="bulk-empty">当前没有内容，请点击“新增一条”。</div>';
    return;
  }
  elements.bulkEditList.innerHTML = bulkDraftItems.map((item, index) => {
    const audioName = item.audioFile?.name || (!item.removeAudio && item.audio?.name) || "未上传 MP3";
    const hasAudio = Boolean(item.audioFile || (!item.removeAudio && item.audio));
    return `
      <article class="bulk-edit-row" data-bulk-index="${index}">
        <div class="bulk-row-heading">
          <strong>第 ${index + 1} 条</strong>
          <span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || STATUS_LABELS[STATUS.NEW])}</span>
          <span class="spacer"></span>
          <button class="icon-button small" type="button" data-bulk-action="up" aria-label="上移" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-button small" type="button" data-bulk-action="down" aria-label="下移" title="下移" ${index === bulkDraftItems.length - 1 ? "disabled" : ""}>↓</button>
          <button class="text-button danger-text" type="button" data-bulk-action="delete">删除</button>
        </div>
        <div class="bulk-fields">
          <label class="field"><span>中文提示</span><textarea rows="2" data-bulk-field="prompt">${escapeHtml(item.prompt)}</textarea></label>
          <label class="field"><span>英文背诵内容</span><textarea rows="2" data-bulk-field="answer">${escapeHtml(item.answer)}</textarea></label>
        </div>
        <label class="field bulk-note"><span>备注</span><input data-bulk-field="note" value="${escapeHtml(item.note)}" /></label>
        <div class="bulk-audio-row">
          <label class="button button-secondary compact">上传本条 MP3<input class="sr-only" type="file" accept="audio/mpeg,.mp3" data-bulk-audio /></label>
          <span title="${escapeHtml(audioName)}">${hasAudio ? "MP3：" : ""}${escapeHtml(audioName)}</span>
          ${hasAudio ? '<button class="text-button danger-text" type="button" data-bulk-action="remove-audio">移除音频</button>' : ""}
        </div>
      </article>`;
  }).join("");
}

function handleBulkEditorInput(event) {
  const row = event.target.closest("[data-bulk-index]");
  const field = event.target.dataset.bulkField;
  const index = Number(row?.dataset.bulkIndex);
  if (!field || !Number.isInteger(index) || !bulkDraftItems[index]) return;
  bulkDraftItems[index][field] = event.target.value;
}

function handleBulkEditorClick(event) {
  const button = event.target.closest("[data-bulk-action]");
  const row = button?.closest("[data-bulk-index]");
  const index = Number(row?.dataset.bulkIndex);
  if (!button || !Number.isInteger(index) || !bulkDraftItems[index]) return;
  const action = button.dataset.bulkAction;
  if (action === "up" && index > 0) {
    [bulkDraftItems[index - 1], bulkDraftItems[index]] = [bulkDraftItems[index], bulkDraftItems[index - 1]];
  } else if (action === "down" && index < bulkDraftItems.length - 1) {
    [bulkDraftItems[index + 1], bulkDraftItems[index]] = [bulkDraftItems[index], bulkDraftItems[index + 1]];
  } else if (action === "delete") {
    bulkDraftItems.splice(index, 1);
  } else if (action === "remove-audio") {
    bulkDraftItems[index].audioFile = null;
    bulkDraftItems[index].removeAudio = true;
  } else {
    return;
  }
  renderBulkEditList();
}

function handleBulkAudioSelection(event) {
  const input = event.target.closest("[data-bulk-audio]");
  const row = input?.closest("[data-bulk-index]");
  const index = Number(row?.dataset.bulkIndex);
  if (!input || !Number.isInteger(index) || !bulkDraftItems[index]) return;
  const file = input.files[0];
  const error = validateMp3File(file);
  if (error) {
    showToast(error, 3500);
    input.value = "";
    return;
  }
  if (!file) return;
  bulkDraftItems[index].audioFile = file;
  bulkDraftItems[index].removeAudio = false;
  renderBulkEditList();
}

async function saveAssignmentEdit(event) {
  event.preventDefault();
  const assignment = state.assignments.find((item) => item.id === bulkEditAssignmentId);
  if (!assignment) return;
  const title = elements.editAssignmentTitleInput.value.trim();
  if (!title) {
    elements.editAssignmentTitleInput.focus();
    return;
  }
  if (!bulkDraftItems.length) {
    showToast("作业本至少需要保留一条内容。", 3200);
    return;
  }
  const invalidIndex = bulkDraftItems.findIndex((item) => !String(item.answer || "").trim());
  if (invalidIndex >= 0) {
    showToast(`第 ${invalidIndex + 1} 条缺少英文背诵内容。`, 3500);
    elements.bulkEditList.querySelector(`[data-bulk-index="${invalidIndex}"] [data-bulk-field="answer"]`)?.focus();
    return;
  }
  const assignmentAudioFile = elements.editAssignmentAudioInput.files[0];
  const audioError = validateMp3File(assignmentAudioFile);
  if (audioError) {
    showToast(audioError, 3500);
    elements.editAssignmentAudioInput.focus();
    return;
  }

  elements.saveAssignmentEditButton.disabled = true;
  elements.saveAssignmentEditButton.textContent = "正在保存…";
  try {
    const retainedIds = new Set(bulkDraftItems.map((item) => item.id));
    const removedAudioKeys = assignment.items
      .filter((item) => !retainedIds.has(item.id))
      .map((item) => itemAudioKey(item.id));
    bulkDraftItems.filter((item) => item.removeAudio).forEach((item) => removedAudioKeys.push(itemAudioKey(item.id)));
    if (bulkAssignmentAudioRemoveRequested) removedAudioKeys.push(assignmentAudioKey(assignment.id));
    let nextAssignmentAudio = bulkAssignmentAudioRemoveRequested ? null : assignment.audio;
    if (assignmentAudioFile) {
      nextAssignmentAudio = await storeMp3(assignmentAudioKey(assignment.id), assignmentAudioFile);
    }

    for (const item of bulkDraftItems) {
      if (item.removeAudio) item.audio = null;
      if (item.audioFile) item.audio = await storeMp3(itemAudioKey(item.id), item.audioFile);
    }
    await deleteAudios(removedAudioKeys).catch(() => {});

    assignment.title = title;
    assignment.type = elements.editAssignmentTypeInput.value;
    assignment.audio = nextAssignmentAudio;
    assignment.items = bulkDraftItems.map((item) => normalizeItem({
      ...item,
      prompt: String(item.prompt || "").trim(),
      answer: String(item.answer || "").trim(),
      note: String(item.note || "").trim(),
      audio: item.audio,
    }));
    assignment.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
    elements.editAssignmentDialog.close();
    showToast("作业本名称、内容和顺序已保存");
  } catch (error) {
    showToast(error.message || "整本修改保存失败，请重试。", 4000);
  } finally {
    elements.saveAssignmentEditButton.disabled = false;
    elements.saveAssignmentEditButton.textContent = "保存整本修改";
  }
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
  if (action === "edit") {
    openEditAssignmentDialog(id);
    return;
  }
  if (action === "move-up" || action === "move-down") {
    const currentIndex = state.assignments.findIndex((item) => item.id === id);
    const targetIndex = currentIndex + (action === "move-up" ? -1 : 1);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= state.assignments.length) return;
    [state.assignments[currentIndex], state.assignments[targetIndex]] = [state.assignments[targetIndex], state.assignments[currentIndex]];
    saveState();
    renderAll();
    showToast("作业本顺序已调整");
    return;
  }
  if (action === "export") {
    downloadJson({ version: 1, ...assignment }, `${assignment.title}.json`);
    showToast("已导出这份作业");
    return;
  }
  if (action === "delete") {
    if (!window.confirm(`确定删除“${assignment.title}”吗？这份作业的背诵进度也会删除。`)) return;
    deleteAudios([
      assignmentAudioKey(assignment.id),
      ...assignment.items.map((item) => itemAudioKey(item.id)),
    ]).catch(() => {});
    state.assignments = state.assignments.filter((item) => item.id !== id);
    if (state.activeAssignmentId === id) state.activeAssignmentId = state.assignments[0]?.id || null;
    saveState();
    renderAll();
    showToast("作业已删除");
  }
}

function openSettings() {
  stopSpeechAndContinuous();
  populateVoices();
  updateTtsStatus();
  elements.rateSelect.value = String(state.settings.rate);
  elements.repeatSelect.value = String(state.settings.repeat);
  elements.autoSpeakInput.checked = Boolean(state.settings.autoSpeak);
  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();
  stopSpeechAndContinuous();
  state.settings.voiceURI = elements.voiceSelect.value;
  state.settings.chineseVoiceURI = elements.chineseVoiceSelect.value;
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
      version: 2,
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
  elements.speakButton.addEventListener("click", () => {
    if (elements.speakButton.classList.contains("speaking")) stopSpeechAndContinuous();
    else speakCurrent();
  });
  elements.speakPromptButton.addEventListener("click", () => {
    const item = getCurrentItem();
    stopSpeechAndContinuous();
    if (item?.prompt) speakText(item.prompt, undefined, { repeat: 1 });
  });
  elements.previousItemButton.addEventListener("click", () => moveItem(-1));
  elements.nextItemButton.addEventListener("click", () => moveItem(1));
  elements.continuousPlayButton.addEventListener("click", toggleContinuousPlay);
  elements.editItemButton.addEventListener("click", openEditItemDialog);
  elements.applyStudyFilterButton.addEventListener("click", () => {
    startStudy(elements.studyStatusFilter.value, elements.studyScopeSelect.value);
  });
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
  elements.contentInput.addEventListener("input", invalidateImportPreview);
  elements.paragraphSplitInput.addEventListener("change", invalidateImportPreview);
  elements.insertExampleButton.addEventListener("click", () => {
    const example = "【中文】名称｜【英文】name\n【中文】我对科学感兴趣｜【英文】I am interested in science.\n【中文】为上课做好准备｜【英文】get ready for class";
    const existing = elements.contentInput.value.trim();
    if (existing) {
      showToast("输入框已有内容；上方可查看示例，清空输入框后可填入。", 3500);
      return;
    }
    elements.contentInput.value = example;
    importFileFormat = "auto";
    invalidateImportPreview();
    elements.contentInput.focus();
    showToast("示例已填入，可直接修改");
  });
  elements.previewList.addEventListener("input", (event) => {
    const field = event.target.dataset.previewField;
    const index = Number(event.target.closest("[data-preview-index]")?.dataset.previewIndex);
    if (!["prompt", "answer"].includes(field) || !parsedImportItems[index]) return;
    parsedImportItems[index][field] = event.target.value;
    const missing = parsedImportItems.filter((item) => !item.answer.trim()).length;
    elements.previewHeading.textContent = `核对 ${parsedImportItems.length} 条${missing ? `，${missing} 条缺少英文` : ""}`;
  });
  elements.importForm.addEventListener("submit", saveImportedAssignment);
  elements.assignmentTypeInput.addEventListener("change", () => {
    if (elements.assignmentTypeInput.value === "text") elements.paragraphSplitInput.checked = true;
    invalidateImportPreview();
  });

  elements.editItemForm.addEventListener("submit", saveEditedItem);
  elements.editAudioInput.addEventListener("change", () => {
    const file = elements.editAudioInput.files[0];
    const error = validateMp3File(file);
    if (error) {
      showToast(error, 3500);
      elements.editAudioInput.value = "";
      return;
    }
    if (!file) return;
    editAudioRemoveRequested = false;
    elements.editAudioName.textContent = `待保存：${file.name} · ${formatFileSize(file.size)}`;
    elements.removeEditAudioButton.hidden = false;
  });
  elements.removeEditAudioButton.addEventListener("click", () => {
    editAudioRemoveRequested = true;
    elements.editAudioInput.value = "";
    elements.editAudioName.textContent = "保存后将移除本条 MP3";
    elements.removeEditAudioButton.hidden = true;
  });
  elements.deleteItemButton.addEventListener("click", deleteCurrentItem);
  elements.editAssignmentForm.addEventListener("submit", saveAssignmentEdit);
  elements.bulkEditList.addEventListener("input", handleBulkEditorInput);
  elements.bulkEditList.addEventListener("click", handleBulkEditorClick);
  elements.bulkEditList.addEventListener("change", handleBulkAudioSelection);
  elements.addBulkItemButton.addEventListener("click", () => {
    bulkDraftItems.push({
      ...normalizeItem({ id: createId("item"), status: STATUS.NEW }),
      audioFile: null,
      removeAudio: false,
    });
    renderBulkEditList();
    elements.bulkEditList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  elements.editAssignmentAudioInput.addEventListener("change", () => {
    const file = elements.editAssignmentAudioInput.files[0];
    const error = validateMp3File(file);
    if (error) {
      showToast(error, 3500);
      elements.editAssignmentAudioInput.value = "";
      return;
    }
    if (!file) return;
    bulkAssignmentAudioRemoveRequested = false;
    elements.editAssignmentAudioName.textContent = `待保存：${file.name} · ${formatFileSize(file.size)}`;
    elements.removeAssignmentAudioButton.hidden = false;
  });
  elements.removeAssignmentAudioButton.addEventListener("click", () => {
    bulkAssignmentAudioRemoveRequested = true;
    elements.editAssignmentAudioInput.value = "";
    elements.editAssignmentAudioName.textContent = "保存后将移除整份 MP3";
    elements.removeAssignmentAudioButton.hidden = true;
  });
  elements.settingsButton.addEventListener("click", openSettings);
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.testSpeechButton.addEventListener("click", () => {
    speakText("名称。名词。今天我们一起学习英语。I am interested in science.", () => {
      updateTtsStatus();
      showToast("试听完成，满意后点击保存设置");
    }, { repeat: 1, rate: Number(elements.rateSelect.value),
      voiceURI: elements.voiceSelect.value, chineseVoiceURI: elements.chineseVoiceSelect.value });
  });
  window.addEventListener("native-tts-ready", () => { populateVoices(); updateTtsStatus(); });
  elements.settingsDialog.addEventListener("close", stopSpeechAndContinuous);
  elements.ttsSettingsButton.addEventListener("click", () => {
    stopSpeechAndContinuous();
    try {
      window.AndroidTts?.openSettings?.();
    } catch {
      showToast("未能打开系统朗读设置，请在手机设置中搜索“文字转语音输出”。", 4200);
    }
  });
  elements.exportBackupButton.addEventListener("click", exportBackup);
  elements.backupFileInput.addEventListener("change", () => restoreBackup(elements.backupFileInput.files[0]));
  elements.reviewAgainButton.addEventListener("click", () => {
    const scope = session?.scope || state.activeAssignmentId;
    elements.completionDialog.close();
    startStudy("focus", scope);
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
