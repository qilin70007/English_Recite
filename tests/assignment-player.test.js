import test from "node:test";
import assert from "node:assert/strict";
import { AssignmentPlayer } from "../assignment-player.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(getAudio = async () => ({ blob: new Blob(["ID3-test"]) })) {
  const media = [], revoked = [], errors = [];
  const player = new AssignmentPlayer({
    getAudio, onError: (error) => errors.push(error),
    createURL: () => `blob:test-${media.length}`,
    revokeURL: (url) => revoked.push(url),
    createAudio: (src) => {
      const audio = {
        src, currentTime: 0, paused: true, ended: false, plays: [], pauseCount: 0,
        play() { this.paused = false; this.ended = false; this.plays.push(this.currentTime); return this.pendingPlay || Promise.resolve(); },
        pause() { this.paused = true; this.pauseCount++; this.onpause?.(); },
        removeAttribute() { this.src = ""; }, load() {},
      };
      media.push(audio);
      return audio;
    },
  });
  return { player, media, revoked, errors };
}

test("whole MP3 pauses and resumes the same source at the exact playback position", async () => {
  const { player, media, revoked } = fixture();
  await player.toggle("assignment:a", 0.85);
  const audio = media[0];
  assert.equal(player.phase, "playing");
  audio.currentTime = 17.5;
  await player.toggle("assignment:a");
  assert.equal(player.phase, "paused");
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 17.5);
  assert.equal(player.hasTrack, true);
  await player.toggle("assignment:a", 1);
  assert.equal(player.phase, "playing");
  assert.deepEqual(audio.plays, [0, 17.5]);
  assert.equal(media.length, 1);
  assert.equal(audio.playbackRate, 1);
  assert.deepEqual(revoked, []);
  player.stop();
  assert.equal(player.phase, "idle");
  assert.deepEqual(revoked, ["blob:test-0"]);
});

test("pausing a pending audio read prevents late autoplay, and can be resumed", async () => {
  const read = deferred();
  const { player, media } = fixture(() => read.promise);
  const loading = player.toggle("assignment:a");
  assert.equal(player.phase, "loading");
  await player.toggle("assignment:a");
  assert.equal(player.phase, "paused");
  read.resolve({ blob: new Blob(["ID3-test"]) });
  await loading;
  assert.equal(media[0].plays.length, 0);
  assert.equal(player.phase, "paused");
  await player.toggle("assignment:a");
  assert.equal(media[0].plays.length, 1);
});

test("resuming before the pending read finishes preserves the latest play intent", async () => {
  const read = deferred();
  const { player, media } = fixture(() => read.promise);
  const loading = player.toggle("assignment:a");
  await player.toggle("assignment:a");
  await player.toggle("assignment:a");
  read.resolve({ blob: new Blob(["ID3-test"]) });
  await loading;
  assert.equal(player.phase, "playing");
  assert.equal(media[0].plays.length, 1);
});

test("switching notebooks or stopping cancels stale IndexedDB reads", async () => {
  const old = deferred();
  const { player, media } = fixture((key) => key === "old" ? old.promise : Promise.resolve({ blob: new Blob(["new"]) }));
  const pending = player.toggle("old");
  await player.toggle("new");
  old.resolve({ blob: new Blob(["old"]) });
  await pending;
  assert.equal(player.key, "new");
  assert.equal(media.length, 1);
  player.stop();
  const read = deferred();
  player.getAudio = () => read.promise;
  const another = player.toggle("old");
  player.stop();
  read.resolve({ blob: new Blob(["old"]) });
  await another;
  assert.equal(player.hasTrack, false);
  assert.equal(media.length, 1);
});

test("a rejected play promise after pause is harmless; genuine errors remain retryable", async () => {
  const { player, media, errors } = fixture();
  await player.toggle("a");
  player.pause();
  const request = deferred();
  media[0].pendingPlay = request.promise;
  const pending = player.resume();
  player.pause();
  request.reject(new Error("play interrupted by pause"));
  await pending;
  assert.equal(player.phase, "paused");
  assert.deepEqual(errors, []);
  media[0].pendingPlay = Promise.reject(new Error("unsupported audio"));
  await player.resume();
  assert.equal(player.phase, "error");
  assert.equal(errors.length, 1);
  await player.toggle("a");
  assert.equal(player.phase, "playing");
  assert.equal(media.length, 2);
});

test("whole MP3 repeats at its end until paused; a late ended event cannot resume it", async () => {
  const { player, media } = fixture();
  await player.toggle("a");
  const audio = media[0];
  assert.equal(audio.loop, true);
  audio.currentTime = 42;
  audio.pause();
  assert.equal(player.phase, "paused");
  await player.toggle("a");
  assert.equal(audio.plays.at(-1), 42);
  for (let round = 0; round < 3; round++) {
    audio.ended = true;
    audio.paused = true;
    audio.onended();
    await Promise.resolve();
    assert.equal(player.phase, "playing");
    assert.equal(player.hasTrack, true);
    assert.equal(audio.plays.at(-1), 0);
  }
  assert.equal(media.length, 1);
  player.pause();
  const count = audio.plays.length;
  audio.onended();
  await Promise.resolve();
  assert.equal(audio.plays.length, count);
  assert.equal(player.phase, "paused");
});

test("missing MP3 reports the problem without inventing a playable track", async () => {
  const { player, media, errors } = fixture(async () => null);
  await player.toggle("a");
  assert.equal(player.phase, "error");
  assert.equal(media.length, 0);
  assert.match(errors[0].message, /重新上传/);
});
