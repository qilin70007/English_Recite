import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS,
  buildCue,
  buildStudyEntries,
  buildSpeechSegments,
  deduplicateItems,
  detectSpeechLanguage,
  matchesStatusFilter,
  isMandarinVoice,
  parseDelimited,
  parseImportedContent,
  summarize,
} from "../core.js";

test("parses Chinese-English lines copied from a textbook", () => {
  const items = parseImportedContent(`
    1. 我对科学感兴趣  I am interested in science.
    2. 我性格外向\tI am outgoing.
    3. 我喜欢交新朋友 | I like making new friends.
  `);

  assert.deepEqual(items, [
    { prompt: "我对科学感兴趣", answer: "I am interested in science." },
    { prompt: "我性格外向", answer: "I am outgoing." },
    { prompt: "我喜欢交新朋友", answer: "I like making new friends." },
  ]);
});

test("pairs a wrapped Chinese prompt with the next English line", () => {
  const items = parseImportedContent(`
    我想要和我的同班同学和睦相处
    I want to get on well with my classmates.
  `);
  assert.deepEqual(items, [{
    prompt: "我想要和我的同班同学和睦相处",
    answer: "I want to get on well with my classmates.",
  }]);
});

test("explicit Chinese/English labels never become content or use language guesses", () => {
  assert.deepEqual(parseImportedContent("【中文】名称｜【英文】name\n【中文】读出 word 的意思｜【英文】a word"), [
    { prompt: "名称", answer: "name" },
    { prompt: "读出 word 的意思", answer: "a word" },
  ]);
  assert.deepEqual(parseImportedContent("【英文】Hello."), [{ prompt: "", answer: "Hello." }]);
});

test("labeled paragraphs preserve line breaks and prompt/answer boundaries", () => {
  assert.deepEqual(parseImportedContent("【中文】自我介绍\n【英文】I am Amy.\nI like science.\n\n【中文】朋友\n【英文】She is kind.", { splitMode: "paragraph" }), [
    { prompt: "自我介绍", answer: "I am Amy.\nI like science." },
    { prompt: "朋友", answer: "She is kind." },
  ]);
});

test("incomplete labels report an actionable error instead of a wrong card", () => {
  assert.throws(() => parseImportedContent("【中文】名称"), /缺少【英文】/);
  assert.throws(() => parseImportedContent("【中文】名称｜【英文】"), /缺少【英文】/);
  assert.throws(() => parseImportedContent("旧内容 Hello\n【中文】名称｜【英文】name"), /不要混用/);
});

test("Chinese words are kept intact and mixed sentences use separate languages", () => {
  assert.deepEqual(buildSpeechSegments("名称。名词。"), [{ text: "名称。名词。", language: "zh-CN" }]);
  assert.deepEqual(buildSpeechSegments("name 名称"), [
    { text: "name", language: "en-US" }, { text: "名称", language: "zh-CN" },
  ]);
  assert.deepEqual(buildSpeechSegments("我喜欢 English。"), [
    { text: "我喜欢", language: "zh-CN" }, { text: "English。", language: "en-US" },
  ]);
  assert.deepEqual(buildSpeechSegments(""), []);
  const longText = "This is a sentence. ".repeat(300).trim();
  const segments = buildSpeechSegments(longText);
  assert.ok(segments.every((part) => part.text.length <= 1500));
  assert.equal(segments.map((part) => part.text).join(" "), longText);
});

test("Mandarin voice selection excludes Cantonese and English", () => {
  assert.equal(isMandarinVoice({ lang: "zh-CN", name: "普通话" }), true);
  assert.equal(isMandarinVoice({ lang: "cmn-CN" }), true);
  assert.equal(isMandarinVoice({ lang: "zh-HK", name: "中文" }), false);
  assert.equal(isMandarinVoice({ lang: "zh-CN", name: "Cantonese" }), false);
  assert.equal(isMandarinVoice({ lang: "yue-HK" }), false);
  assert.equal(isMandarinVoice({ lang: "en-US" }), false);
});

test("parses quoted CSV fields", () => {
  const rows = parseDelimited('中文,英文\n"你好，朋友","Hello, friend."');
  assert.deepEqual(rows, [["中文", "英文"], ["你好，朋友", "Hello, friend."]]);
});

test("imports common JSON field aliases", () => {
  const items = parseImportedContent('[{"zh":"谢谢","en":"Thank you."}]', { format: "json" });
  assert.deepEqual(items, [{ prompt: "谢谢", answer: "Thank you.", note: "" }]);
});

test("deduplicates exact content while keeping the latest unique rows", () => {
  const items = deduplicateItems([
    { prompt: "你好", answer: "Hello." },
    { prompt: "你好", answer: "Hello." },
    { prompt: "再见", answer: "Goodbye." },
  ]);
  assert.equal(items.length, 2);
});

test("starting study preserves imported order despite mixed statuses and review dates", () => {
  const imported = parseImportedContent("【中文】名称｜【英文】name\n【中文】科学｜【英文】science\n【中文】上课｜【英文】class\n【中文】学习｜【英文】learn");
  const items = imported.map((item, index) => ({ ...item, id: item.answer,
    status: [STATUS.MASTERED, STATUS.NEW, STATUS.FUZZY, STATUS.UNKNOWN][index],
    lastReviewed: ["2026-09-12", "2026-09-11", "2026-09-10", "2026-09-09"][index],
  }));
  const assignments = [{ id: "daily", items }];
  const before = JSON.stringify(assignments);
  assert.deepEqual(buildStudyEntries(assignments, "daily").map((entry) => entry.itemId), ["name", "science", "class", "learn"]);
  assert.equal(JSON.stringify(assignments), before, "building a queue cannot mutate saved contents");
  items[0].status = STATUS.UNKNOWN;
  items[3].status = STATUS.MASTERED;
  items[0].lastReviewed = "2026-09-20";
  assert.deepEqual(buildStudyEntries(assignments, "daily").map((entry) => entry.itemId), ["name", "science", "class", "learn"]);
});

test("status filters and all-notebook study preserve each notebook's saved order", () => {
  const books = [{ id: "b", items: [
    { id: "f1", status: STATUS.FUZZY, lastReviewed: "2026-09-12" },
    { id: "m", status: STATUS.MASTERED },
    { id: "u", status: STATUS.UNKNOWN },
    { id: "f2", status: STATUS.FUZZY, lastReviewed: "2026-09-10" },
  ] }, { id: "a", items: [{ id: "a1", status: STATUS.UNKNOWN }] }];
  assert.deepEqual(buildStudyEntries(books, "b", "focus").map((entry) => entry.itemId), ["f1", "u", "f2"]);
  assert.deepEqual(buildStudyEntries(books, "b", "fuzzy").map((entry) => entry.itemId), ["f1", "f2"]);
  assert.deepEqual(buildStudyEntries(books).map((entry) => entry.itemId), ["f1", "m", "u", "f2", "a1"]);
  [books[0].items[0], books[0].items[2]] = [books[0].items[2], books[0].items[0]];
  assert.deepEqual(buildStudyEntries(books, "b", "focus").map((entry) => entry.itemId), ["u", "f1", "f2"], "manual sorting takes effect");
});

test("filters one or several review statuses", () => {
  assert.equal(matchesStatusFilter({ status: STATUS.UNKNOWN }, "unknown"), true);
  assert.equal(matchesStatusFilter({ status: STATUS.FUZZY }, "unknown"), false);
  assert.equal(matchesStatusFilter({ status: STATUS.FUZZY }, "focus"), true);
  assert.equal(matchesStatusFilter({ status: STATUS.UNKNOWN }, "focus"), true);
  assert.equal(matchesStatusFilter({ status: STATUS.MASTERED }, "focus"), false);
});

test("builds a cross-assignment study queue in notebook order", () => {
  const assignments = [
    { id: "a", items: [{ id: "a1", status: STATUS.FUZZY }, { id: "a2", status: STATUS.MASTERED }] },
    { id: "b", items: [{ id: "b1", status: STATUS.UNKNOWN }] },
  ];
  assert.deepEqual(buildStudyEntries(assignments, "all", "focus"), [
    { assignmentId: "a", itemId: "a1" },
    { assignmentId: "b", itemId: "b1" },
  ]);
  assert.deepEqual(buildStudyEntries(assignments, "b", "unknown"), [
    { assignmentId: "b", itemId: "b1" },
  ]);
});

test("chooses Chinese TTS for Chinese labels and English TTS for sentences", () => {
  assert.equal(detectSpeechLanguage("名词"), "zh-CN");
  assert.equal(detectSpeechLanguage("n. 名词"), "zh-CN");
  assert.equal(detectSpeechLanguage("I am interested in science."), "en-US");
});

test("summarizes progress and builds a short paragraph cue", () => {
  const summary = summarize([
    { status: STATUS.MASTERED },
    { status: STATUS.MASTERED },
    { status: STATUS.FUZZY },
    { status: STATUS.UNKNOWN },
  ]);
  assert.equal(summary.mastery, 50);
  assert.equal(buildCue("I want to get on well with my classmates."), "I want to …");
});
