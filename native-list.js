import { buildSpeechSegments } from "./core.js";

// Prepare exactly the current filtered queue. Only per-item recordings belong to
// it; a notebook's whole MP3 remains a separate playback mode.
export async function prepareNativeList(native, run, items, index, settings, readAudio, isCurrent) {
  if (!native.prepare(run)) throw new Error("无法准备播放清单，请检查手机剩余空间后重试。");
  try {
    const queue = [];
    for (let i = 0; i < items.length; i++) {
      if (!isCurrent()) { native.stop(run); return false; }
      const item = items[i];
      const entry = {
        id: item.id,
        prompt: item.prompt?.trim() && item.answer?.trim() ? buildSpeechSegments(item.prompt) : [],
        answer: buildSpeechSegments(item.answer || item.prompt || ""),
        audio: false,
      };
      if (item.audio) {
        const record = await readAudio(`item:${item.id}`);
        if (!isCurrent()) { native.stop(run); return false; }
        if (record?.blob?.size) {
          for (let offset = 0; offset < record.blob.size; offset += 65536) {
            const bytes = new Uint8Array(await record.blob.slice(offset, offset + 65536).arrayBuffer());
            if (!isCurrent()) { native.stop(run); return false; }
            let binary = "";
            for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
            if (!native.appendAudio(run, i, btoa(binary))) throw new Error("音频准备失败，请检查手机剩余空间后重试。");
          }
          entry.audio = true;
        }
      }
      queue.push(entry);
    }
    if (!isCurrent()) { native.stop(run); return false; }
    native.start(run, JSON.stringify({ items: queue, index, recall: settings.playbackMode === "recall",
      answerWait: settings.answerWait, repeat: settings.repeat, rate: settings.rate,
      voiceURI: settings.voiceURI, chineseVoiceURI: settings.chineseVoiceURI }));
    return true;
  } catch (error) { native.stop(run); throw error; }
}
