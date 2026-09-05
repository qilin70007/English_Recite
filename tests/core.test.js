import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS,
  buildCue,
  buildStudyEntries,
  deduplicateItems,
  detectSpeechLanguage,
  matchesStatusFilter,
  parseDelimited,
  parseImportedContent,
  sortForReview,
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

test("sorts unknown and fuzzy content before new and mastered content", () => {
  const items = sortForReview([
    { id: "m", status: STATUS.MASTERED },
    { id: "n", status: STATUS.NEW },
    { id: "f", status: STATUS.FUZZY },
    { id: "u", status: STATUS.UNKNOWN },
  ]);
  assert.deepEqual(items.map((item) => item.id), ["u", "f", "n", "m"]);
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
