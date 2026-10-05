import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyEntries } from '../core.js';
import { learningEntries } from '../review.js';

const books = [
  { id: 'a', reviewEnabled: true, items: [
    { id: 'a1', status: 'mastered', difficult: true, review: { dueDate: '2026-10-05' } },
    { id: 'a2', status: 'unknown', difficult: false },
  ] },
  { id: 'b', items: [{ id: 'b1', status: 'unknown', difficult: true }] },
  { id: 'c', reviewEnabled: true, items: [
    { id: 'c1', status: 'fuzzy', difficult: true, review: { dueDate: '2026-10-06' } },
    { id: 'c2', status: 'mastered', difficult: false },
  ] },
];
const ids = entries => entries.map(e => e.itemId);

test('multi-notebook scope preserves library/item order, ignores duplicates and missing IDs', () => {
  const before = JSON.stringify(books);
  assert.deepEqual(ids(buildStudyEntries(books, ['c', 'a', 'a', 'removed'])), ['a1', 'a2', 'c1', 'c2']);
  assert.deepEqual(ids(buildStudyEntries(books, ['c', 'a'], 'focus')), ['a2', 'c1']);
  assert.deepEqual(buildStudyEntries(books, []), []);
  assert.deepEqual(buildStudyEntries(books, ['removed']), []);
  assert.deepEqual(ids(buildStudyEntries(books, 'a')), ['a1', 'a2']);
  assert.equal(buildStudyEntries(books, 'all').length, 5);
  assert.equal(JSON.stringify(books), before);
});

test('multi-notebook difficulty and due filters intersect without losing mastered starred entries', () => {
  assert.deepEqual(ids(learningEntries(books, ['a', 'c'], 'all', { difficultOnly: true })), ['a1', 'c1']);
  assert.deepEqual(ids(learningEntries(books, ['a', 'c'], 'focus', { difficultOnly: true })), ['c1']);
  assert.deepEqual(ids(learningEntries(books, ['a', 'c'], 'all', {
    difficultOnly: true, dueOnly: true, date: new Date('2026-10-05T12:00:00'),
  })), ['a1']);
});
