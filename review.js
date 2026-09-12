import { STATUS, buildStudyEntries, getTodayKey } from "./core.js";

export const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const weak = (status) => status === STATUS.UNKNOWN || status === STATUS.FUZZY;
const validDay = (day) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && getTodayKey(new Date(`${day}T12:00:00`)) === day;

export function addDays(day, days) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return getTodayKey(date);
}

export function normalizeLearning(item) {
  const difficult = typeof item.difficult === "boolean" ? item.difficult : weak(item.status);
  const source = item.review;
  const review = source && validDay(source.dueDate) ? {
    dueDate: source.dueDate,
    stage: Math.max(-1, Math.min(4, Math.trunc(Number(source.stage) || 0))),
    lastDate: validDay(source.lastDate) ? source.lastDate : null,
  } : null;
  return { difficult, difficultyAutoSeen: typeof item.difficultyAutoSeen === "boolean"
    ? item.difficultyAutoSeen : difficult || typeof item.difficult === "boolean", review };
}

export function setDifficulty(item, value) {
  item.difficult = Boolean(value);
  item.difficultyAutoSeen = true;
}

// Listening and navigation never call this function. Only a self-assessment does.
export function assessItem(item, status, reviewEnabled, date = new Date()) {
  if (![STATUS.UNKNOWN, STATUS.FUZZY, STATUS.MASTERED].includes(status)) return;
  Object.assign(item, normalizeLearning(item));
  if (weak(status) && !item.difficultyAutoSeen) setDifficulty(item, true);
  item.status = status;
  item.lastReviewed = date.toISOString();
  item.reviewCount = (Number(item.reviewCount) || 0) + 1;
  if (!reviewEnabled) return;
  const today = getTodayKey(date);
  const previous = item.review;
  if (weak(status) || !previous) {
    item.review = { stage: 0, dueDate: addDays(today, 1), lastDate: today };
    return;
  }
  // Never jump multiple intervals in a day or postpone a due date by early practice.
  if (previous.lastDate === today || previous.dueDate > today) {
    previous.lastDate = today;
    return;
  }
  const stage = Math.min(4, previous.stage + 1);
  item.review = { stage, dueDate: addDays(today, REVIEW_INTERVALS[stage]), lastDate: today };
}

export function configureReview(assignment, enabled, date = new Date()) {
  assignment.reviewEnabled = Boolean(enabled);
  if (!enabled) return;
  for (const item of assignment.items) {
    if (item.status !== STATUS.NEW && !item.review) {
      item.review = { stage: -1, dueDate: getTodayKey(date), lastDate: null };
    }
  }
}

export function isDue(item, assignment, date = new Date()) {
  return assignment.reviewEnabled === true && Boolean(item.review?.dueDate)
    && item.review.dueDate <= getTodayKey(date);
}

export function learningEntries(assignments, scope = "all", filter = "all", options = {}) {
  const lookup = new Map(assignments.map((a) => [a.id, { assignment: a, items: new Map(a.items.map((i) => [i.id, i])) }]));
  return buildStudyEntries(assignments, scope, filter).filter((entry) => {
    const { assignment, items } = lookup.get(entry.assignmentId);
    const item = items.get(entry.itemId);
    return (!options.difficultOnly || item.difficult) && (!options.dueOnly || isDue(item, assignment, options.date));
  });
}
