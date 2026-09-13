import test from "node:test";
import assert from "node:assert/strict";
import { prepareNativeList } from "../native-list.js";

test("Android receives the selected ordered entries, bilingual segments, waits and exact per-item MP3 bytes", async () => {
  const bytes = new Uint8Array(140002).map((_, i) => i % 251);
  const chunks = [];
  let payload;
  const native = { prepare: () => true, appendAudio(run, index, base64) {
    assert.equal(run, "run"); assert.equal(index, 1);
    const chunk = Buffer.from(base64, "base64"); assert.ok(chunk.length <= 65536); chunks.push(chunk); return true;
  }, start(run, json) { payload = JSON.parse(json); }, stop() { assert.fail("Unexpected stop"); } };
  const items = [{ id: "third", prompt: "科学", answer: "science" }, { id: "first", prompt: "名称", answer: "name", audio: { name: "word.mp3" } }];
  await prepareNativeList(native, "run", items, 1, { playbackMode: "recall", answerWait: 10, repeat: 2, rate: 0.8 }, async key => {
    assert.equal(key, "item:first"); return { blob: new Blob([bytes]) };
  }, () => true);
  assert.deepEqual(payload.items.map(i => i.id), ["third", "first"]);
  assert.deepEqual(payload.items.map(i => i.audio), [false, true]);
  assert.equal(payload.items[0].prompt[0].language, "zh-CN");
  assert.equal(payload.items[0].answer[0].language, "en-US");
  assert.equal(payload.index, 1); assert.equal(payload.answerWait, 10); assert.equal(payload.recall, true);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));
});

test("cancelling audio preparation never starts a stale Android queue", async () => {
  let current = true, stops = 0;
  const native = { prepare: () => true, stop: () => stops++, start: () => assert.fail("Cancelled"), appendAudio: () => assert.fail("Cancelled") };
  const result = await prepareNativeList(native, "old", [{ id: "a", answer: "hello", audio: {} }], 0, {}, async () => {
    current = false; return { blob: new Blob(["ID3"]) };
  }, () => current);
  assert.equal(result, false); assert.equal(stops, 1);
});

test("missing item audio falls back to TTS and missing Chinese skips the prompt", async () => {
  let queue;
  const native = { prepare: () => true, start: (run, json) => queue = JSON.parse(json), stop() {} };
  await prepareNativeList(native, "r", [{ id: "a", answer: "hello", audio: {} }], 0, {}, async () => null, () => true);
  assert.equal(queue.items[0].audio, false);
  assert.deepEqual(queue.items[0].prompt, []);
  assert.equal(queue.items[0].answer[0].text, "hello");
});
