import test from 'node:test';
import assert from 'node:assert/strict';
import { studyGroups, studyRange } from '../core.js';
import { learningEntries } from '../review.js';

test('groups use one-based original positions, include the last partial group and accept custom sizes', () => {
  assert.deepEqual(studyGroups(100, 20), [{ start: 1, end: 20 }, { start: 21, end: 40 }, { start: 41, end: 60 }, { start: 61, end: 80 }, { start: 81, end: 100 }]);
  assert.deepEqual(studyGroups(103, 20).at(-1), { start: 101, end: 103 });
  assert.deepEqual(studyGroups(5, 20), [{ start: 1, end: 5 }]);
  assert.deepEqual(studyGroups(6, 3), [{ start: 1, end: 3 }, { start: 4, end: 6 }]);
  for (const size of [0, -1, 1.5, NaN]) assert.deepEqual(studyGroups(100, size), []);
  assert.deepEqual(studyGroups(0, 20), []);
});

test('custom ranges include both endpoints and reject invalid bounds', () => {
  assert.deepEqual(studyRange(100, '60', '79'), { start: 60, end: 79 });
  assert.deepEqual(studyRange(100, 100, 100), { start: 100, end: 100 });
  for (const pair of [[0, 20], [60, 101], [80, 60], ['', 10], [1.5, 20], [1, Infinity]]) assert.equal(studyRange(100, ...pair), null);
});

test('range intersects status, difficulty and due filters without renumbering or changing stored data', () => {
  const books = [{ id: 'a', reviewEnabled: true, items: Array.from({ length: 100 }, (_, index) => ({
    id: `w${index + 1}`, status: (index + 1) % 10 === 0 ? 'fuzzy' : 'mastered', difficult: (index + 1) % 20 === 0,
    review: { dueDate: '2026-10-12' },
  })) }, { id: 'b', items: [{ id: 'other', status: 'fuzzy', difficult: true }] }];
  const before = JSON.stringify(books);
  const range = { assignmentId: 'a', start: 60, end: 79 };
  const ids = entries => entries.map(e => e.itemId);
  assert.deepEqual(ids(learningEntries(books, 'a', 'all', { range })), Array.from({ length: 20 }, (_, i) => `w${i + 60}`));
  assert.deepEqual(ids(learningEntries(books, 'all', 'fuzzy', { range })), ['w60', 'w70']);
  assert.deepEqual(ids(learningEntries(books, ['a', 'b'], 'all', { range, difficultOnly: true, dueOnly: true, date: new Date('2026-10-12T12:00:00') })), ['w60']);
  assert.deepEqual(learningEntries(books, 'b', 'all', { range }), []);
  assert.deepEqual(learningEntries(books, 'a', 'all', { range: { ...range, end: 110 } }), []);
  assert.equal(JSON.stringify(books), before);
  [books[0].items[59], books[0].items[60]] = [books[0].items[60], books[0].items[59]];
  assert.deepEqual(ids(learningEntries(books, 'a', 'all', { range: { ...range, end: 60 } })), ['w61'], 'manual ordering determines original positions');
});
