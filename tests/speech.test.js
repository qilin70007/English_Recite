import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpeechText, buildSpeechSegments, parseImportedContent } from '../core.js';
import { prepareNativeList } from '../native-list.js';

test('dictionary part-of-speech labels are spoken in Chinese, with or without dots', () => {
  for (const [tag, meaning] of Object.entries({ n: '名词', v: '动词', vt: '及物动词', vi: '不及物动词', adj: '形容词', adv: '副词', pron: '代词', prep: '介词', conj: '连词', num: '数词', art: '冠词', det: '限定词', aux: '助动词', interj: '感叹词' })) {
    assert.equal(normalizeSpeechText(`${tag}. 示例`), `${meaning} 示例`);
    assert.equal(normalizeSpeechText(`${tag} 示例`), `${meaning} 示例`);
  }
  assert.equal(normalizeSpeechText('adv'), '副词');
  assert.equal(normalizeSpeechText('n. / v. 名称'), '名词 / 动词 名称');
  assert.equal(normalizeSpeechText('v.t. 帮助；v.i. 工作'), '及物动词 帮助；不及物动词 工作');
  assert.equal(normalizeSpeechText('a. 美丽的\nADJ． 可爱的'), '形容词 美丽的\n形容词 可爱的');
});

test('school vocabulary placeholders and possessives expand as whole words', () => {
  assert.equal(normalizeSpeechText('sb'), 'somebody');
  assert.equal(normalizeSpeechText('ask sb. to do sth.'), 'ask somebody to do something.');
  assert.equal(normalizeSpeechText('sb’s / sb.\'s / sth’s'), "somebody's / somebody's / something's");
  assert.equal(normalizeSpeechText('give sbd sth'), 'give somebody something');
  assert.equal(normalizeSpeechText('Ask sb. Do sth.'), 'Ask somebody. Do something.');
  assert.equal(normalizeSpeechText('对sb.友好'), '对somebody友好');
});

test('ordinary articles, words, initials, variables and links are not grammar labels', () => {
  for (const text of ['a', 'a friend', 'A good day.', 'She likes art.', 'This is an ad.', 'Prep for school.', 'a 中文说明', 'N. Smith', 'V. Brown', 'n = 3', 'v = 5', 'art', 'modal', 'husband USB sbCode sthValue advantage', 'name@example.com', 'https://example.com/sb/adv', 'sb.example.com']) {
    assert.equal(normalizeSpeechText(text), text, text);
  }
});

test('POS expansion precedes language selection and preserves multi-line speech order', () => {
  assert.deepEqual(buildSpeechSegments('n. 名称\nadv. 快速地\nask sb. to do sth.'), [
    { text: '名词 名称\n副词 快速地', language: 'zh-CN' },
    { text: 'ask somebody to do something.', language: 'en-US' },
  ]);
  assert.deepEqual(buildSpeechSegments('help (vt.) sb.'), [
    { text: 'help (', language: 'en-US' },
    { text: '及物动词)', language: 'zh-CN' },
    { text: 'somebody.', language: 'en-US' },
  ]);
});

test('speech normalization does not rewrite imported/displayed/exported content', () => {
  const [item] = parseImportedContent('【中文】n. 名称｜【英文】ask sb. to do sth.');
  const before = JSON.stringify(item);
  buildSpeechSegments(item.prompt);
  buildSpeechSegments(item.answer);
  assert.equal(JSON.stringify(item), before);
  assert.equal(item.prompt, 'n. 名称');
  assert.equal(item.answer, 'ask sb. to do sth.');
});

test('native background queue gets expanded bilingual segments, retaining recording priority and learning data', async () => {
  let payload;
  const native = { prepare: () => true, appendAudio: () => true, start: (run, json) => { payload = JSON.parse(json); }, stop: () => assert.fail('Unexpected stop') };
  const items = [{ id: 'a', prompt: 'adv 快速地', answer: 'help sb. do sth.', status: 'fuzzy', audio: { name: 'word.mp3' } }, { id: 'b', prompt: 'n. 名称', answer: "sb's name" }];
  const before = JSON.stringify(items);
  await prepareNativeList(native, 'r', items, 0, { playbackMode: 'recall', answerWait: 5, repeat: 2 }, async () => ({ blob: new Blob(['audio']) }), () => true);
  assert.deepEqual(payload.items[0].prompt, [{ text: '副词 快速地', language: 'zh-CN' }]);
  assert.deepEqual(payload.items[0].answer, [{ text: 'help somebody do something.', language: 'en-US' }]);
  assert.deepEqual(payload.items[1].answer, [{ text: "somebody's name", language: 'en-US' }]);
  assert.equal(payload.items[0].audio, true);
  assert.equal(payload.recall, true);
  assert.equal(payload.answerWait, 5);
  assert.equal(JSON.stringify(items), before);
});
