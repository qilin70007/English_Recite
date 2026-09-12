// Native Handler timers keep the same queue progressing while Android is locked.
// The browser fallback uses ordinary timers; both routes have cancellable tokens.
const pending = new Map();
let serial = 0;
globalThis.addEventListener?.("native-playback-timer", (event) => {
  const id = event.detail?.id;
  const task = pending.get(id);
  if (!task) return;
  pending.delete(id);
  task.callback();
});

export function playbackDelay(callback, milliseconds) {
  const id = `playback-${++serial}`;
  const task = { callback, timer: null, native: false };
  pending.set(id, task);
  try {
    if (typeof globalThis.AndroidPlayback?.schedule === "function") {
      globalThis.AndroidPlayback.schedule(id, milliseconds);
      task.native = true;
      return id;
    }
  } catch { /* Fall back when the bridge is unavailable. */ }
  task.timer = setTimeout(() => {
    if (!pending.delete(id)) return;
    callback();
  }, milliseconds);
  return id;
}

export function cancelPlaybackDelay(id) {
  const task = pending.get(id);
  if (!task) return;
  pending.delete(id);
  clearTimeout(task.timer);
  if (task.native) {
    try { globalThis.AndroidPlayback?.cancel(id); } catch { /* Token remains invalid. */ }
  }
}
