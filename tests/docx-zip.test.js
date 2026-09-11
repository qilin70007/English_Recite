import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openZip } from "../archive.js";

const fixture = () => readFile(new URL("./fixtures/homework.docx", import.meta.url));

test("reads compressed Word XML with CRC validation, leaving backup mode strict", async () => {
  const file = new Blob([await fixture()]);
  await assert.rejects(openZip(file), /格式不支持/);
  const zip = await openZip(file, { allowDeflate: true, maxEntrySize: 8 * 1024 * 1024 });
  const xml = await (await zip.get("word/document.xml").read()).text();
  assert.match(xml, /名称/);
  assert.match(xml, /name/);
  assert.match(xml, /&amp;/);
});

test("oversized or corrupted compressed Word text is rejected", async () => {
  const bytes = new Uint8Array(await fixture());
  const limited = await openZip(new Blob([bytes]), { allowDeflate: true, maxEntrySize: 10 });
  await assert.rejects(limited.get("word/document.xml").read(), /正文过大/);
  const view = new DataView(bytes.buffer);
  // Alter the central directory checksum without changing readable compressed data.
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const length = view.getUint16(offset + 28, true);
    if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length)) === "word/document.xml") {
      view.setUint32(offset + 16, view.getUint32(offset + 16, true) ^ 1, true);
      break;
    }
  }
  const corrupt = await openZip(new Blob([bytes]), { allowDeflate: true });
  await assert.rejects(corrupt.get("word/document.xml").read(), /已损坏/);
});
