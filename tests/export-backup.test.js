import test from "node:test";
import assert from "node:assert/strict";
import { createZip, openZip, crc32 } from "../archive.js";
import { createUnmasteredDocx, selectUnmastered, DOCX_MIME } from "../word-export.js";
import { audioLocations, createBackup, readBackup, stageRestore } from "../backup.js";
import { downloadFile } from "../file-download.js";

const metadata = { name: "同名.mp3", type: "audio/mpeg", size: 8 };
const fixture = () => ({ version: 2, activeAssignmentId: "b", settings: { rate: 0.7 }, assignments: [
  { id: "b", title: "第二本 & 校对", type: "mixed", audio: metadata, items: [
    { id: "i2", prompt: "名称", answer: "name & <label>", note: "保留中文备注", status: "fuzzy", reviewCount: 3, audio: metadata },
    { id: "i1", prompt: "课文", answer: "First line.\nSecond line.", status: "unknown" },
    { id: "i3", prompt: "已掌握", answer: "mastered secret", status: "mastered" },
    { id: "i4", prompt: "未标记", answer: "unmarked", status: "new" },
  ] },
  { id: "a", title: "第一本", items: [{ id: "i5", answer: "hello", status: "unknown", audio: metadata }] },
] });
const blobs = new Map([
  ["assignment:b", new Blob(["ID3-BOOK-whole"])],
  ["item:i2", new Blob(["ID3-NAME-word"])],
  ["item:i5", new Blob(["ID3-HELLO-word"])],
]);
const readAudio = async (key) => blobs.has(key) ? { blob: blobs.get(key), ...metadata } : null;

test("dictation Word has Chinese prompts and writing lines but no answer or answer-bearing notes", async () => {
  const data = fixture();
  data.assignments[0].items[0].note = "答案提示：name";
  const docx = await createUnmasteredDocx(data.assignments, { scope: "b", layout: "dictation" });
  const zip = await openZip(docx);
  const xml = await (await zip.get("word/document.xml").read()).text();
  assert.match(xml, /英语中文默写练习/);
  assert.match(xml, /名称/);
  assert.match(xml, /w:leader="underscore"/);
  assert.match(xml, /w:w="11906" w:h="16838"/);
  assert.doesNotMatch(xml, /name|First line|Second line|答案提示|备注：|英文：|不认识|模糊|未标记|中文提示：|范围：/);
  const styles = await (await zip.get("word/styles.xml").read()).text();
  assert.match(styles, /w:styleId="DictationEntry"[\s\S]*?w:sz w:val="32"/);
  await assert.rejects(createUnmasteredDocx(data.assignments, { layout: "dictation" }), /缺少中文提示/);
});

test("long dictation prompts stay complete and text retains expandable ruled writing space", async () => {
  const prompt = "我们应该互相帮助，一起适应新的学校生活。".repeat(5);
  const docx = await createUnmasteredDocx([{ id: "long", title: "课文", type: "text", items: [{ prompt, answer: "A long English passage. ".repeat(30), status: "unknown" }] }], { layout: "dictation" });
  const zip = await openZip(docx);
  const xml = await (await zip.get("word/document.xml").read()).text();
  assert.ok(xml.includes(prompt));
  assert.match(xml, /w:between/);
  assert.doesNotMatch(xml, /A long English|不认识/);
});

test("ZIP is binary, uses standard CRC32, and supports Unicode paths and chunk boundaries", async () => {
  assert.equal(await crc32(new Blob(["123456789"])), 0xcbf43926);
  const big = new Uint8Array(2 * 1024 * 1024 + 21).fill(203);
  const zip = await createZip([{ name: "目录/名称.mp3", blob: new Blob([big]) }, { name: "empty", blob: new Blob() }]);
  assert.deepEqual([...new Uint8Array(await zip.slice(0, 4).arrayBuffer())], [80, 75, 3, 4]);
  const entries = await openZip(zip);
  assert.deepEqual(new Uint8Array(await (await entries.get("目录/名称.mp3").read()).arrayBuffer()), big);
  assert.equal((await entries.get("empty").read()).size, 0);
  await assert.rejects(openZip(zip.slice(0, zip.size - 1)), /不完整/);
});

test("Word selects only requested unmastered statuses without changing notebook/entry order", async () => {
  const data = fixture();
  assert.deepEqual(selectUnmastered(data.assignments).map((a) => a.items.map((i) => i.id)), [["i2", "i1"], ["i5"]]);
  assert.deepEqual(selectUnmastered(data.assignments, "b", ["new", "mastered"]).map((a) => a.items.map((i) => i.id)), [["i4"]]);
  const docx = await createUnmasteredDocx(data.assignments, { scope: "b", date: new Date("2026-09-09T10:00:00Z") });
  assert.equal(docx.type, DOCX_MIME);
  const zip = await openZip(docx);
  assert.ok(zip.has("[Content_Types].xml") && zip.has("word/styles.xml") && zip.has("_rels/.rels"));
  const xml = await (await zip.get("word/document.xml").read()).text();
  assert.match(xml, /名称/);
  assert.match(xml, /name &amp; &lt;label&gt;/);
  assert.match(xml, /保留中文备注/);
  assert.match(xml, /<w:br\/>/);
  assert.doesNotMatch(xml, /mastered secret|unmarked|hello/);
  assert.ok(xml.indexOf("name &amp;") < xml.indexOf("First line"));
  await assert.rejects(createUnmasteredDocx(data.assignments, { statuses: [] }), /没有/);
});

test("Word combines selected notebooks in their displayed order, excluding unselected notebooks", async () => {
  const books = fixture().assignments;
  books.splice(1, 0, { id: "skip", title: "不要导出这本", items: [{ answer: "excluded notebook", status: "unknown" }] });
  const selected = ["a", "b"];
  assert.deepEqual(selectUnmastered(books, selected).map((book) => book.id), ["b", "a"]);
  const docx = await createUnmasteredDocx(books, { scope: selected });
  const entries = await openZip(docx);
  const xml = await (await entries.get("word/document.xml").read()).text();
  assert.match(xml, /第二本 &amp; 校对/);
  assert.match(xml, /第一本/);
  assert.doesNotMatch(xml, /不要导出这本|excluded notebook|mastered secret|unmarked/);
  assert.ok(xml.indexOf("name &amp;") < xml.indexOf("hello"));
  assert.deepEqual(selectUnmastered(books, []), []);
  await assert.rejects(createUnmasteredDocx(books, { scope: [] }), /没有/);
});

test("backup restores exact MP3 bytes and original association, even with identical filenames", async () => {
  const data = fixture();
  const backup = await createBackup(data, readAudio);
  assert.equal(backup.audioCount, 3);
  assert.equal(backup.missingCount, 0);
  const restored = await readBackup(backup.blob, async () => { throw new Error("ZIP must not depend on old device storage"); });
  assert.deepEqual(restored.state, data);
  assert.equal(restored.audios.length, 3);
  for (const audio of restored.audios) assert.equal(await audio.blob.text(), await blobs.get(audio.oldKey).text());
  const zip = await openZip(backup.blob);
  const manifest = JSON.parse(await (await zip.get("backup.json").read()).text());
  assert.deepEqual(manifest.audio.map((a) => [a.key, a.assignmentIndex, a.itemIndex, a.path]), [
    ["assignment:b", 0, null, "audio/00001.mp3"], ["item:i2", 0, 0, "audio/00002.mp3"], ["item:i5", 1, 0, "audio/00003.mp3"],
  ]);
});

test("missing audio is explicit, with metadata and owner retained in ZIP and legacy JSON", async () => {
  const data = fixture();
  const backup = await createBackup(data, async () => null);
  assert.equal(backup.missingCount, 3);
  const restored = await readBackup(backup.blob, readAudio);
  assert.equal(restored.missingCount, 3);
  assert.equal(restored.state.assignments[0].items[0].audio.name, "同名.mp3");
  const legacy = await readBackup(new Blob([JSON.stringify(data)]), readAudio);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.audios.length, 3);
  const moved = await readBackup(new Blob([JSON.stringify(data)]), async () => null);
  assert.equal(moved.missingCount, 3);
});

test("backup rejects corrupt audio, missing archive parts, duplicate IDs and wrong association", async () => {
  const backup = await createBackup(fixture(), readAudio);
  const bytes = new Uint8Array(await backup.blob.arrayBuffer());
  const marker = new TextEncoder().encode("ID3-NAME-word");
  const start = bytes.findIndex((_, index) => marker.every((b, offset) => bytes[index + offset] === b));
  assert.ok(start > 0);
  bytes[start] ^= 1;
  await assert.rejects(readBackup(new Blob([bytes]), readAudio), /已损坏/);
  const entries = await openZip(backup.blob);
  const manifest = JSON.parse(await (await entries.get("backup.json").read()).text());
  await assert.rejects(readBackup(await createZip([{ name: "backup.json", blob: new Blob([JSON.stringify(manifest)]) }]), readAudio), /缺失/);
  manifest.audio[0].assignmentIndex = 99;
  await assert.rejects(readBackup(await createZip([{ name: "backup.json", blob: new Blob([JSON.stringify(manifest)]) }]), readAudio), /不匹配/);
  const duplicate = fixture();
  duplicate.assignments[1].items[0].id = "i2";
  await assert.rejects(readBackup(new Blob([JSON.stringify(duplicate)]), readAudio), /编号重复/);
});

test("restoration staging remaps all IDs, active notebook and audio without touching source", () => {
  const original = fixture();
  const before = JSON.stringify(original);
  let counter = 0;
  const staged = stageRestore(original, (prefix) => `${prefix}-${++counter}`);
  assert.equal(JSON.stringify(original), before);
  assert.equal(staged.state.activeAssignmentId, staged.state.assignments[0].id);
  assert.deepEqual(staged.state.assignments.map((a) => a.title), original.assignments.map((a) => a.title));
  for (const location of audioLocations(original)) assert.ok(staged.keys.get(location.key));
  assert.equal(staged.state.assignments[0].items[0].reviewCount, 3);
});

test("native file bridge transfers binary in bounded chunks and waits for save/cancel/failure", async () => {
  const prior = globalThis.window;
  try {
    for (const status of ["saved", "cancelled", "error"]) {
      const window = new EventTarget();
      globalThis.window = window;
      const chunks = [];
      let ended = false;
      window.AndroidFiles = {
        beginFile: (name, mime) => { assert.equal(name, "test.docx"); assert.equal(mime, DOCX_MIME); return "transfer"; },
        appendFile: (id, chunk) => { assert.equal(id, "transfer"); const bytes = Buffer.from(chunk, "base64"); assert.ok(bytes.length <= 65536); chunks.push(bytes); return true; },
        finishFile: () => { setTimeout(() => { ended = true; window.dispatchEvent(new CustomEvent("native-file-saved", { detail: { id: "transfer", status } })); }, 5); return true; },
        cancelFile() {},
      };
      const bytes = new Uint8Array(150001).map((_, index) => index % 256);
      const task = downloadFile(new Blob([bytes], { type: DOCX_MIME }), "test.docx");
      if (status === "error") await assert.rejects(task, /保存失败/);
      else assert.equal(await task, status === "saved");
      assert.equal(ended, true);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));
    }
  } finally { globalThis.window = prior; }
});
