import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLearning, setDifficulty, assessItem, configureReview, learningEntries, addDays } from "../review.js";
import { createBackup, readBackup, stageRestore } from "../backup.js";
const day = (text) => new Date(`${text}T12:00:00`);
const item = (status = "new") => ({ id: "i", prompt: "名称", answer: "name", status, ...normalizeLearning({ status }) });

test("difficulty records the first weak assessment even after an earlier mastered assessment", () => {
  const i = item();
  assessItem(i, "mastered", false, day("2026-09-12"));
  assert.equal(i.difficult, false);
  assessItem(i, "fuzzy", false, day("2026-09-13"));
  assert.equal(i.difficult, true);
  assessItem(i, "mastered", false, day("2026-09-14"));
  assert.equal(i.difficult, true);
  setDifficulty(i, false);
  Object.assign(i, normalizeLearning(JSON.parse(JSON.stringify(i))));
  assessItem(i, "unknown", false, day("2026-09-15"));
  assert.equal(i.difficult, false, "manual removal survives reload and later failures");
  setDifficulty(i, true);
  assert.equal(i.difficult, true);
});

test("migration stars weak legacy items only; new items remain eligible for automatic stars", () => {
  assert.equal(normalizeLearning({ status: "unknown" }).difficult, true);
  assert.equal(normalizeLearning({ status: "fuzzy" }).difficult, true);
  assert.equal(normalizeLearning({ status: "mastered" }).difficult, false);
  const i = item();
  Object.assign(i, normalizeLearning(i));
  assert.equal(i.difficultyAutoSeen, false);
  assessItem(i, "unknown", false);
  assert.equal(i.difficult, true);
});

test("review advances through local calendar intervals, once per day, and remains at 30 days", () => {
  const i = item();
  assessItem(i, "mastered", true, day("2026-09-12"));
  assert.equal(i.review.dueDate, "2026-09-13");
  for (const [date, next] of [["2026-09-13", "2026-09-16"], ["2026-09-16", "2026-09-23"], ["2026-09-23", "2026-10-07"], ["2026-10-07", "2026-11-06"], ["2026-11-06", "2026-12-06"]]) {
    assessItem(i, "mastered", true, day(date));
    assert.equal(i.review.dueDate, next);
    assessItem(i, "mastered", true, day(date));
    assert.equal(i.review.dueDate, next);
  }
});

test("early practice does not postpone review, failure resets it even if practiced correctly later that day", () => {
  const i = item();
  i.review = { stage: 3, dueDate: "2026-09-20", lastDate: "2026-09-06" };
  assessItem(i, "mastered", true, day("2026-09-12"));
  assert.equal(i.review.dueDate, "2026-09-20");
  assessItem(i, "fuzzy", true, day("2026-09-12"));
  assessItem(i, "mastered", true, day("2026-09-12"));
  assert.deepEqual(i.review, { stage: 0, dueDate: "2026-09-13", lastDate: "2026-09-12" });
  assessItem(i, "unknown", true, day("2026-09-15"));
  assert.equal(i.review.dueDate, "2026-09-16");
});

test("enrollment includes learned legacy items today, leaves unseen items unscheduled, and pauses without deleting dates", () => {
  const a = { id: "a", items: [item("mastered"), { ...item(), id: "j" }] };
  configureReview(a, true, day("2026-09-12"));
  assert.equal(a.items[0].review.dueDate, "2026-09-12");
  assert.equal(a.items[1].review, null);
  assert.equal(learningEntries([a], "all", "all", { dueOnly: true, date: day("2026-09-15") }).length, 1);
  configureReview(a, false);
  assert.equal(learningEntries([a], "all", "all", { dueOnly: true }).length, 0);
  assessItem(a.items[0], "fuzzy", false, day("2026-09-14"));
  assert.equal(a.items[0].review.dueDate, "2026-09-12");
});

test("scope, status, stars and overdue filters combine without reordering", () => {
  const a = { id: "a", reviewEnabled: true, items: [
    { ...item("mastered"), id: "1", difficult: true, review: { dueDate: "2026-09-10" } },
    { ...item("fuzzy"), id: "2", review: { dueDate: "2026-09-12" } },
    { ...item("unknown"), id: "3", review: { dueDate: "2026-09-13" } },
  ] };
  const options = { difficultOnly: true, dueOnly: true, date: day("2026-09-12") };
  assert.deepEqual(learningEntries([a], "all", "all", options).map((e) => e.itemId), ["1", "2"]);
  assert.deepEqual(learningEntries([a], "a", "fuzzy", options).map((e) => e.itemId), ["2"]);
  assert.equal(learningEntries([a], "absent", "all", options).length, 0);
});

test("calendar arithmetic crosses month, year and leap day without UTC shifts", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2028-02-29", 1), "2028-03-01");
  assert.equal(normalizeLearning({ review: { dueDate: "2026-02-30" } }).review, null);
});

test("ZIP backup and ID replacement preserve review schedules, manual stars, enrollment and listening preferences", async () => {
  const i = item();
  assessItem(i, "unknown", true, day("2026-09-12"));
  setDifficulty(i, false);
  const state = { reviewPlanConfigured: true, activeAssignmentId: "a", settings: { playbackMode: "recall", answerWait: 10 }, assignments: [{ id: "a", title: "作业", reviewEnabled: true, items: [i] }] };
  const { blob } = await createBackup(state, async () => null);
  const restored = await readBackup(blob, async () => null);
  assert.deepEqual(restored.state, state);
  let id = 0;
  const staged = stageRestore(restored.state, () => String(++id));
  assert.equal(staged.state.reviewPlanConfigured, true);
  assert.equal(staged.state.assignments[0].reviewEnabled, true);
  assert.deepEqual(staged.state.assignments[0].items[0].review, i.review);
  assert.equal(staged.state.assignments[0].items[0].difficultyAutoSeen, true);
});
