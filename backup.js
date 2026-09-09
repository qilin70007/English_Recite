import { createZip, openZip } from "./archive.js";

const MAX_AUDIO_SIZE = 40 * 1024 * 1024;
const MAX_STATE_SIZE = 16 * 1024 * 1024;

// The original storage key and ordered owner coordinates are recorded alongside
// the bytes. A browser file upload cannot provide a reusable absolute phone path.
export function audioLocations(state) {
  const locations = [];
  state.assignments.forEach((assignment, assignmentIndex) => {
    if (assignment.audio) locations.push({ key: `assignment:${assignment.id}`, assignmentId: assignment.id, assignmentIndex, itemId: null, itemIndex: null, title: assignment.title, metadata: assignment.audio });
    assignment.items.forEach((item, itemIndex) => {
      if (item.audio) locations.push({ key: `item:${item.id}`, assignmentId: assignment.id, assignmentIndex, itemId: item.id, itemIndex, title: assignment.title, metadata: item.audio });
    });
  });
  return locations;
}

function validateState(state) {
  if (!state || !Array.isArray(state.assignments)) throw new Error("这不是有效的英语背诵助手备份。");
  const assignmentIds = new Set(), itemIds = new Set();
  for (const assignment of state.assignments) {
    if (!assignment || typeof assignment.id !== "string" || !assignment.id || assignmentIds.has(assignment.id) || !Array.isArray(assignment.items) || typeof assignment.title !== "string") throw new Error("备份中的作业本信息不完整或编号重复。");
    assignmentIds.add(assignment.id);
    for (const item of assignment.items) {
      if (!item || typeof item.id !== "string" || !item.id || itemIds.has(item.id) || typeof item.answer !== "string") throw new Error("备份中的词条信息不完整或编号重复。");
      itemIds.add(item.id);
    }
  }
}

export async function createBackup(state, getAudio, onProgress = () => {}) {
  const snapshot = JSON.parse(JSON.stringify(state));
  validateState(snapshot);
  const manifest = { format: "english-recite-backup", backupVersion: 1, exportedAt: new Date().toISOString(), state: snapshot, audio: [] };
  const files = [];
  const locations = audioLocations(snapshot);
  let missingCount = 0;
  for (const [index, location] of locations.entries()) {
    onProgress(`正在读取音频 ${index + 1} / ${locations.length}…`);
    const record = await getAudio(location.key);
    const available = record?.blob instanceof Blob;
    if (available && record.blob.size > MAX_AUDIO_SIZE) throw new Error("备份中有音频超过 40 MB，请先检查该音频。");
    const path = available ? `audio/${String(index + 1).padStart(5, "0")}.mp3` : null;
    manifest.audio.push({ ...location, path, missing: !available, size: available ? record.blob.size : location.metadata.size });
    if (available) files.push({ name: path, blob: record.blob });
    else missingCount++;
  }
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  if (manifestBlob.size > MAX_STATE_SIZE) throw new Error("作业文字超过备份大小限制，请先分批整理。");
  files.unshift({ name: "backup.json", blob: manifestBlob });
  const blob = await createZip(files, "application/zip", (done, total) => onProgress(`正在打包备份 ${done} / ${total}…`));
  return { blob, audioCount: locations.length - missingCount, missingCount };
}

export async function readBackup(file, getAudio, onProgress = () => {}) {
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const zip = signature[0] === 0x50 && signature[1] === 0x4b;
  let incoming, manifest, entries;
  if (zip) {
    entries = await openZip(file);
    const descriptor = entries.get("backup.json");
    if (!descriptor || descriptor.size > MAX_STATE_SIZE) throw new Error("备份中缺少有效的作业和音频清单。");
    manifest = JSON.parse(await (await descriptor.read()).text());
    if (manifest.format !== "english-recite-backup" || manifest.backupVersion !== 1 || !Array.isArray(manifest.audio)) throw new Error("不支持这个备份版本，请使用对应版本的软件恢复。");
    incoming = manifest.state;
  } else {
    if (file.size > MAX_STATE_SIZE) throw new Error("JSON 文件过大，请选择正确的备份文件。");
    incoming = JSON.parse(await file.text());
  }
  validateState(incoming);
  const locations = audioLocations(incoming);
  const descriptors = new Map();
  if (zip) {
    const paths = new Set();
    for (const entry of manifest.audio) {
      if (!entry || typeof entry.key !== "string" || descriptors.has(entry.key) || (entry.path && paths.has(entry.path))) throw new Error("备份的音频对应关系重复或无效。");
      descriptors.set(entry.key, entry);
      if (entry.path) paths.add(entry.path);
    }
    if (descriptors.size !== locations.length) throw new Error("备份的音频数量与作业内容不一致。");
  }
  const audios = [];
  let missingCount = 0;
  for (const [index, location] of locations.entries()) {
    onProgress(`正在校验音频 ${index + 1} / ${locations.length}…`);
    let blob;
    if (zip) {
      const descriptor = descriptors.get(location.key);
      if (!descriptor || descriptor.assignmentId !== location.assignmentId || descriptor.itemId !== location.itemId || descriptor.assignmentIndex !== location.assignmentIndex || descriptor.itemIndex !== location.itemIndex) throw new Error("备份中的音频位置与词条不匹配。");
      if (!descriptor.missing) {
        const entry = entries.get(descriptor.path);
        if (!entry || entry.size !== descriptor.size || entry.size > MAX_AUDIO_SIZE) throw new Error("备份中的音频文件缺失或大小异常。");
        blob = await entry.read();
      }
    } else {
      // Legacy JSON can reconnect audio already on this device using its old ID.
      const existing = await getAudio(location.key);
      if (existing?.blob instanceof Blob) blob = existing.blob;
    }
    if (blob) {
      if (blob.size > MAX_AUDIO_SIZE) throw new Error("备份中的单个音频超过 40 MB。");
      audios.push({ oldKey: location.key, blob, metadata: location.metadata });
    } else missingCount++;
  }
  return { state: incoming, audios, missingCount, legacy: !zip };
}

// Restore into fresh IDs first. If any disk write fails, the current notebooks
// and their audio are untouched; the caller can discard only these new records.
export function stageRestore(incoming, createId) {
  const state = JSON.parse(JSON.stringify(incoming));
  const keys = new Map();
  state.assignments.forEach((assignment) => {
    const oldId = assignment.id;
    assignment.id = createId("assignment");
    keys.set(`assignment:${oldId}`, `assignment:${assignment.id}`);
    if (state.activeAssignmentId === oldId) state.activeAssignmentId = assignment.id;
    assignment.items.forEach((item) => {
      const oldItemId = item.id;
      item.id = createId("item");
      keys.set(`item:${oldItemId}`, `item:${item.id}`);
    });
  });
  return { state, keys };
}
