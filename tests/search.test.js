import test from 'node:test';
import assert from 'node:assert/strict';
import { searchEntries } from '../search.js';
import { parseImportedContent } from '../core.js';

const books = [{ id: 'a', title: '星期一作业', items: [
  { id: 'a1', prompt: '名字\n名称', answer: 'Name', status: 'mastered' },
  { id: 'a2', prompt: '科学', answer: 'I like\nscience.', note: '易错', status: 'unknown' },
] }, { id: 'b', title: '星期二作业', items: [{ id: 'b1', prompt: '名字', answer: 'name', status: 'fuzzy' }] }];

test('search matches literal Chinese, case-insensitive English, titles and multiple terms in original order', () => {
  const snapshot = JSON.stringify(books);
  assert.deepEqual(searchEntries(books, 'ＮＡＭＥ').map(r => r.item.id), ['a1', 'b1']);
  assert.deepEqual(searchEntries(books, '名称').map(r => r.item.id), ['a1']);
  assert.deepEqual(searchEntries(books, '星期一 science').map(r => r.index), [1]);
  assert.equal(searchEntries(books, 'like science').length, 1);
  assert.equal(searchEntries(books, '易错').length, 1);
  assert.deepEqual(searchEntries(books, '名字', 'b').map(r => r.item.id), ['b1']);
  assert.equal(searchEntries(books, '.*').length, 0);
  assert.equal(searchEntries(books, '   ').length, 0);
  assert.equal(searchEntries(books, 'name', 'deleted').length, 0);
  assert.equal(JSON.stringify(books), snapshot);
});

test('multiline imports retain breaks in labeled text, quoted CSV, JSON and paragraphs', () => {
  const prompt = '名字\n名称', answer = 'My name is Amy.\nI like science.';
  assert.deepEqual(parseImportedContent(`【中文】${prompt}\n【英文】${answer}`), [{ prompt, answer }]);
  assert.deepEqual(parseImportedContent(`中文,英文\n"${prompt}","${answer}"`, { format: 'csv' }), [{ prompt, answer }]);
  assert.deepEqual(parseImportedContent(JSON.stringify([{ prompt, answer }]), { format: 'json' }), [{ prompt, answer, note: '' }]);
  assert.deepEqual(parseImportedContent(`${answer}\n\nAnother paragraph.`, { splitMode: 'paragraph' }), [{ prompt: '', answer }, { prompt: '', answer: 'Another paragraph.' }]);
});
