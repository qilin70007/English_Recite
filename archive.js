// Offline ZIP32: write STORE backups; optionally read DEFLATE entries for DOCX.
// Blob slices keep MP3 backups out of one giant in-memory/base64 string.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export async function crc32(blob) {
  let crc = 0xffffffff;
  for (let start = 0; start < blob.size; start += 1024 * 1024) {
    const chunk = new Uint8Array(await blob.slice(start, start + 1024 * 1024).arrayBuffer());
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

export async function createZip(files, type = "application/zip", onProgress = () => {}) {
  if (files.length >= 65535) throw new Error("备份中的文件过多，请分批整理后重试。");
  const parts = [], directory = [], names = new Set();
  let offset = 0, directorySize = 0;
  for (const [index, file] of files.entries()) {
    const name = encoder.encode(file.name);
    if (!name.length || name.length > 65535 || names.has(file.name)) throw new Error("重复或无效的文件名。");
    names.add(file.name);
    const blob = file.blob instanceof Blob ? file.blob : new Blob([file.blob]);
    if (offset + blob.size + name.length + 30 >= 0xffffffff) throw new Error("单份备份超过 4 GB，请先分批整理音频。");
    onProgress(index, files.length);
    const crc = await crc32(blob);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x800, true); // UTF-8 names
    local.view.setUint16(12, 0x21, true); // 1980-01-01
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, blob.size, true);
    local.view.setUint32(22, blob.size, true);
    local.view.setUint16(26, name.length, true);
    parts.push(local.bytes, name, blob);
    const central = header(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x800, true);
    central.view.setUint16(14, 0x21, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, blob.size, true);
    central.view.setUint32(24, blob.size, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint32(42, offset, true);
    directory.push(central.bytes, name);
    directorySize += 46 + name.length;
    offset += 30 + name.length + blob.size;
  }
  if (offset + directorySize + 22 >= 0xffffffff) throw new Error("备份超过 ZIP 文件大小限制。");
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, offset, true);
  onProgress(files.length, files.length);
  return new Blob([...parts, ...directory, end.bytes], { type });
}

export async function openZip(blob, { allowDeflate = false, maxEntrySize = Infinity, invalidMessage } = {}) {
  const invalid = () => new Error(invalidMessage || "备份包不完整或格式不支持，请选择本软件导出的原始 ZIP 文件。");
  if (blob.size < 22 || blob.size >= 0xffffffff) throw invalid();
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && !(tail.getUint32(end, true) === 0x06054b50 && end + 22 + tail.getUint16(end + 20, true) === tail.byteLength)) end--;
  if (end < 0 || tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)) throw invalid();
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const start = tail.getUint32(end + 16, true);
  if (count === 65535 || count !== tail.getUint16(end + 8, true) || size > 16 * 1024 * 1024 || start + size !== tailStart + end) throw invalid();
  const data = new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
  const view = new DataView(data.buffer);
  const entries = new Map();
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size || view.getUint32(cursor, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedLength = view.getUint32(cursor + 20, true);
    const length = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const total = 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    const position = view.getUint32(cursor + 42, true);
    if (cursor + total > size || flags & 0x41 || (method !== 0 && !(allowDeflate && method === 8)) || view.getUint16(cursor + 34, true) || (method === 0 && length !== compressedLength) || position + 30 > start) throw invalid();
    const name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || entries.has(name)) throw invalid();
    const local = new DataView(await blob.slice(position, position + 30).arrayBuffer());
    const localNameLength = local.getUint16(26, true);
    const bodyStart = position + 30 + localNameLength + local.getUint16(28, true);
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) & 0x41 || local.getUint16(8, true) !== method || bodyStart + compressedLength > start) throw invalid();
    const localName = decoder.decode(await blob.slice(position + 30, position + 30 + localNameLength).arrayBuffer());
    if (localName !== name) throw invalid();
    const body = blob.slice(bodyStart, bodyStart + compressedLength);
    entries.set(name, {
      size: length,
      async read() {
        if (length > maxEntrySize) throw new Error("文档正文过大，请按作业拆分后再导入。");
        const content = method === 8 ? await inflateRaw(body, length) : body;
        if (await crc32(content) !== crc) throw new Error(`压缩包中的 ${name} 已损坏，请重新保存文件。`);
        return content;
      },
    });
    cursor += total;
  }
  if (cursor !== size) throw invalid();
  return entries;
}

async function inflateRaw(blob, expectedSize) {
  let decompressor;
  try { decompressor = new DecompressionStream("deflate-raw"); }
  catch { throw new Error("当前浏览器内核暂不支持读取压缩 DOCX，请更新 Android System WebView 或浏览器后重试。"); }
  const reader = blob.stream().pipeThrough(decompressor).getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize) throw new Error("DOCX 数据长度异常，请重新保存文件后上传。");
      chunks.push(value);
    }
    if (size !== expectedSize) throw new Error("DOCX 数据不完整，请重新保存文件后上传。");
    return new Blob(chunks);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
