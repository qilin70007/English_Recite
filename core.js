export const STATUS = Object.freeze({
  NEW: "new",
  UNKNOWN: "unknown",
  FUZZY: "fuzzy",
  MASTERED: "mastered",
});

const STATUS_ORDER = {
  [STATUS.UNKNOWN]: 0,
  [STATUS.FUZZY]: 1,
  [STATUS.NEW]: 2,
  [STATUS.MASTERED]: 3,
};

export function normalizeText(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .trim();
}

export function stripListPrefix(value = "") {
  return normalizeText(value)
    .replace(/^\s*[✓√✔☑☐]?\s*(?:\(?\d{1,3}\)?\s*[.、．):：-]\s*|[①-⑳]\s*)/, "")
    .trim();
}

export function hasChinese(value = "") {
  return /[\u3400-\u9fff]/.test(value);
}

export function hasLatin(value = "") {
  return /[A-Za-z]/.test(value);
}

function cleanPart(value = "") {
  return stripListPrefix(value)
    .replace(/^\s*[|｜→⇒]+\s*|\s*[|｜→⇒]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitExplicit(line) {
  const delimiters = [/\t+/, /\s*[|｜]\s*/, /\s*(?:=>|→|⇒)\s*/];
  for (const delimiter of delimiters) {
    const parts = line.split(delimiter).map(cleanPart).filter(Boolean);
    if (parts.length >= 2) {
      return [parts[0], parts.slice(1).join(" ")];
    }
  }
  return null;
}

function orientPair(left, right) {
  const leftChinese = hasChinese(left);
  const rightChinese = hasChinese(right);
  const leftLatin = hasLatin(left);
  const rightLatin = hasLatin(right);

  if (leftChinese && rightLatin && !rightChinese) {
    return { prompt: cleanPart(left), answer: cleanPart(right) };
  }
  if (rightChinese && leftLatin && !leftChinese) {
    return { prompt: cleanPart(right), answer: cleanPart(left) };
  }
  return { prompt: cleanPart(left), answer: cleanPart(right) };
}

function splitMixedLine(line) {
  const cleaned = stripListPrefix(line);
  const explicit = splitExplicit(cleaned);
  if (explicit) return orientPair(explicit[0], explicit[1]);

  if (hasChinese(cleaned) && hasLatin(cleaned)) {
    const firstChinese = cleaned.search(/[\u3400-\u9fff]/);
    const firstLatin = cleaned.search(/[A-Za-z]/);

    if (firstChinese < firstLatin) {
      return orientPair(cleaned.slice(0, firstLatin), cleaned.slice(firstLatin));
    }

    const firstChineseAfterLatin = cleaned.slice(firstLatin).search(/[\u3400-\u9fff]/);
    if (firstChineseAfterLatin >= 0) {
      const splitAt = firstLatin + firstChineseAfterLatin;
      return orientPair(cleaned.slice(0, splitAt), cleaned.slice(splitAt));
    }
  }

  return null;
}

export function parseDelimited(text, delimiter = ",") {
  const input = normalizeText(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function rowsToItems(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const promptIndex = header.findIndex((cell) => /^(prompt|front|chinese|中文|提示)$/.test(cell));
  const answerIndex = header.findIndex((cell) => /^(answer|back|english|英文|背诵内容)$/.test(cell));
  const hasHeader = promptIndex >= 0 || answerIndex >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row) => {
      if (hasHeader) {
        const prompt = cleanPart(promptIndex >= 0 ? row[promptIndex] : "");
        const answer = cleanPart(answerIndex >= 0 ? row[answerIndex] : row[0]);
        return { prompt, answer };
      }
      if (row.length >= 2) return orientPair(row[0], row.slice(1).join(" "));
      return { prompt: "", answer: cleanPart(row[0]) };
    })
    .filter((item) => item.answer || item.prompt);
}

export function parseJsonItems(text) {
  const parsed = JSON.parse(text);
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.assignments)
        ? parsed.assignments.flatMap((assignment) => assignment.items || [])
        : [];

  return source
    .map((item) => {
      if (typeof item === "string") return { prompt: "", answer: cleanPart(item) };
      const prompt = cleanPart(item.prompt ?? item.front ?? item.chinese ?? item.zh ?? "");
      const answer = cleanPart(item.answer ?? item.back ?? item.english ?? item.en ?? item.text ?? "");
      return { prompt, answer, note: cleanPart(item.note ?? "") };
    })
    .filter((item) => item.answer || item.prompt);
}

function parseParagraphs(text) {
  return normalizeText(text)
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((answer) => ({ prompt: "", answer }));
}

// Labels take precedence over language guesses, including in paragraph mode.
function parseLabeledText(text) {
  const tags = [...text.matchAll(/【(中文|英文)】/g)];
  if (!tags.length) return null;
  if (stripListPrefix(text.slice(0, tags[0].index))) {
    throw new Error("使用标签时，请让每条以【中文】或【英文】开头；不要混用未标注的内容。");
  }
  const items = [];
  let current = null;
  let hasAnswer = false;
  const finish = () => {
    if (!current) return;
    if (!hasAnswer || !current.answer) {
      throw new Error(`第 ${items.length + 1} 条缺少【英文】内容，请补充后预览。`);
    }
    items.push(current);
  };
  tags.forEach((tag, index) => {
    const value = text.slice(tag.index + tag[0].length, tags[index + 1]?.index ?? text.length)
      .replace(/[|｜\s]+$/, "").trim();
    if (tag[1] === "中文" || hasAnswer) {
      finish();
      current = { prompt: "", answer: "" };
      hasAnswer = false;
    }
    if (!current) current = { prompt: "", answer: "" };
    if (tag[1] === "中文") current.prompt = value;
    else {
      current.answer = value;
      hasAnswer = true;
    }
  });
  finish();
  return items;
}

export function parsePlainText(text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const labeledItems = parseLabeledText(normalized);
  if (labeledItems) return labeledItems;

  if (options.splitMode === "paragraph") {
    return parseParagraphs(normalized);
  }

  const lines = normalized
    .split("\n")
    .map(stripListPrefix)
    .filter(Boolean);
  const items = [];
  let pendingPrompt = "";

  for (const line of lines) {
    const pair = splitMixedLine(line);
    if (pair) {
      if (pendingPrompt && !pair.prompt) pair.prompt = pendingPrompt;
      pendingPrompt = "";
      items.push(pair);
      continue;
    }

    if (hasChinese(line) && !hasLatin(line)) {
      if (pendingPrompt) {
        items.push({ prompt: pendingPrompt, answer: "" });
      }
      pendingPrompt = cleanPart(line);
      continue;
    }

    if (pendingPrompt) {
      items.push({ prompt: pendingPrompt, answer: cleanPart(line) });
      pendingPrompt = "";
    } else {
      items.push({ prompt: "", answer: cleanPart(line) });
    }
  }

  if (pendingPrompt) items.push({ prompt: pendingPrompt, answer: "" });
  return items.filter((item) => item.answer || item.prompt);
}

export function parseImportedContent(text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const format = (options.format || "auto").toLowerCase();

  if (format === "json" || (format === "auto" && /^[\[{]/.test(normalized))) {
    try {
      const jsonItems = parseJsonItems(normalized);
      if (jsonItems.length) return jsonItems;
    } catch {
      if (format === "json") throw new Error("JSON 格式不正确，请检查后重试。");
    }
  }

  if (format === "csv") return rowsToItems(parseDelimited(normalized, ","));
  if (format === "tsv") return rowsToItems(parseDelimited(normalized, "\t"));
  return parsePlainText(normalized, options);
}

export function deduplicateItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${cleanPart(item.prompt).toLowerCase()}\u0000${cleanPart(item.answer).toLowerCase()}`;
    if (!key.replace("\u0000", "") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortForReview(items = []) {
  return [...items].sort((a, b) => {
    const statusDifference = (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
    if (statusDifference !== 0) return statusDifference;
    const reviewedA = a.lastReviewed ? new Date(a.lastReviewed).getTime() : 0;
    const reviewedB = b.lastReviewed ? new Date(b.lastReviewed).getTime() : 0;
    return reviewedA - reviewedB;
  });
}

export function matchesStatusFilter(item, filter = "all") {
  const status = Object.values(STATUS).includes(item?.status) ? item.status : STATUS.NEW;
  if (filter === "focus") return status === STATUS.UNKNOWN || status === STATUS.FUZZY;
  if (filter === STATUS.UNKNOWN) return status === STATUS.UNKNOWN;
  if (filter === STATUS.FUZZY) return status === STATUS.FUZZY;
  if (filter === STATUS.MASTERED) return status === STATUS.MASTERED;
  if (filter === STATUS.NEW) return status === STATUS.NEW;
  return true;
}

export function buildStudyEntries(assignments = [], scope = "all", filter = "all") {
  const selectedAssignments = scope === "all"
    ? assignments
    : assignments.filter((assignment) => assignment.id === scope);
  return selectedAssignments.flatMap((assignment) => sortForReview(
    (assignment.items || []).filter((item) => matchesStatusFilter(item, filter)),
  ).map((item) => ({ assignmentId: assignment.id, itemId: item.id })));
}

export function detectSpeechLanguage(text = "") {
  const value = String(text);
  const chineseCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (value.match(/[A-Za-z]/g) || []).length;
  return chineseCount > 0 && (latinCount === 0 || chineseCount * 2 >= latinCount)
    ? "zh-CN"
    : "en-US";
}

// Keep whole Chinese phrases intact, but never send mixed Chinese to an English voice.
export function buildSpeechSegments(text = "") {
  const segments = [];
  let buffer = "";
  let language = "";
  for (const character of normalizeText(text)) {
    const nextLanguage = hasChinese(character) ? "zh-CN" : hasLatin(character) ? "en-US" : "";
    if (nextLanguage && language && nextLanguage !== language) {
      if (buffer.trim()) segments.push({ text: buffer.trim(), language });
      buffer = "";
    }
    if (nextLanguage) language = nextLanguage;
    buffer += character;
  }
  if (buffer.trim()) segments.push({ text: buffer.trim(), language: language || "en-US" });
  return segments.flatMap((segment) => {
    // Stay below Android's input limit, splitting at sentence/word boundaries.
    const chunks = [];
    let remaining = segment.text;
    while (remaining.length > 1500) {
      const prefix = remaining.slice(0, 1500);
      const boundaries = [...prefix.matchAll(/[。！？.!?\n]\s*|\s+/g)];
      const last = boundaries.at(-1);
      const cut = last && last.index > 500 ? last.index + last[0].length : 1500;
      chunks.push({ text: remaining.slice(0, cut).trim(), language: segment.language });
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push({ text: remaining, language: segment.language });
    return chunks;
  });
}

export function isMandarinVoice(voice = {}) {
  const lang = String(voice.lang || "").replaceAll("_", "-").toLowerCase();
  return /^(zh(?:-|$)|cmn(?:-|$))/.test(lang)
    && !/^(zh-(hk|mo)|zh-yue)(-|$)/.test(lang)
    && !/cantonese|粤语|廣東話|广东话/i.test(voice.name || "");
}

export function summarize(items = []) {
  const summary = { total: items.length, new: 0, unknown: 0, fuzzy: 0, mastered: 0 };
  for (const item of items) {
    const status = Object.values(STATUS).includes(item.status) ? item.status : STATUS.NEW;
    summary[status] += 1;
  }
  summary.mastery = summary.total ? Math.round((summary.mastered / summary.total) * 100) : 0;
  return summary;
}

export function buildCue(text = "", wordCount = 3) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  const words = normalized.split(/\s+/);
  if (words.length <= wordCount) return `${words[0]} …`;
  return `${words.slice(0, wordCount).join(" ")} …`;
}

export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function reviewedToday(item, date = new Date()) {
  if (!item?.lastReviewed) return false;
  return getTodayKey(new Date(item.lastReviewed)) === getTodayKey(date);
}
