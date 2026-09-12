// A notebook MP3 owns its media element and playback position independently of
// card/TTS navigation. Loop until paused; pause preserves the playback position.
export class AssignmentPlayer {
  constructor({ getAudio, onChange = () => {}, onError = () => {}, createAudio = (url) => new Audio(url), createURL = (blob) => URL.createObjectURL(blob), revokeURL = (url) => URL.revokeObjectURL(url) }) {
    Object.assign(this, { getAudio, onChange, onError, createAudio, createURL, revokeURL });
    this.key = null;
    this.phase = "idle";
    this.audio = null;
    this.url = "";
    this.generation = 0;
    this.playRequest = 0;
    this.wantPlay = false;
  }

  get hasTrack() { return ["loading", "playing", "paused"].includes(this.phase); }

  setPhase(phase) {
    this.phase = phase;
    this.onChange(phase);
  }

  pause() {
    if (!this.hasTrack) return;
    this.wantPlay = false;
    this.playRequest++;
    this.audio?.pause();
    this.setPhase("paused");
  }

  stop() {
    this.generation++;
    this.playRequest++;
    this.wantPlay = false;
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.onended = audio.onerror = audio.onpause = audio.onplaying = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (this.url) this.revokeURL(this.url);
    this.url = "";
    this.key = null;
    this.setPhase("idle");
  }

  fail(error, generation) {
    if (generation !== this.generation) return;
    const key = this.key;
    this.stop();
    this.key = key;
    this.setPhase("error");
    this.onError(error);
  }

  async resume(rate = 1) {
    this.wantPlay = true;
    this.setPhase("loading");
    if (!this.audio) return; // A paused IndexedDB read is still pending.
    const audio = this.audio;
    const generation = this.generation;
    const request = ++this.playRequest;
    audio.playbackRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
    try {
      await audio.play();
      if (generation !== this.generation || request !== this.playRequest) return;
      if (this.wantPlay) this.setPhase("playing");
    } catch (error) {
      // pause() rejects an outstanding play() promise on real media elements.
      if (generation !== this.generation || request !== this.playRequest || !this.wantPlay) return;
      this.fail(error, generation);
    }
  }

  async toggle(key, rate = 1) {
    if (this.key === key && ["loading", "playing"].includes(this.phase)) {
      this.pause();
      return;
    }
    if (this.key === key && this.phase === "paused") return this.resume(rate);
    if (this.key === key && this.phase === "ended" && this.audio) {
      this.audio.currentTime = 0;
      return this.resume(rate);
    }
    this.stop();
    this.key = key;
    this.wantPlay = true;
    const generation = this.generation;
    this.setPhase("loading");
    try {
      const record = await this.getAudio(key);
      if (generation !== this.generation) return;
      if (!(record?.blob instanceof Blob)) throw new Error("整份 MP3 在本机已找不到，请在作业本中重新上传。");
      this.url = this.createURL(record.blob);
      const audio = this.createAudio(this.url);
      this.audio = audio;
      audio.preload = "auto";
      audio.loop = true;
      audio.onended = () => {
        if (generation !== this.generation) return;
        // Native looping normally prevents ended; also handle engines that emit it.
        if (!this.wantPlay) return;
        audio.currentTime = 0;
        void this.resume(audio.playbackRate);
      };
      audio.onerror = () => this.fail(new Error("整份 MP3 暂时无法播放，请重试或检查音频文件。"), generation);
      audio.onpause = () => {
        if (generation === this.generation && audio.paused && !audio.ended && this.phase !== "ended") {
          this.wantPlay = false;
          this.playRequest++;
          this.setPhase("paused");
        }
      };
      audio.onplaying = () => {
        if (generation === this.generation && this.wantPlay && !audio.paused) this.setPhase("playing");
      };
      if (this.wantPlay) await this.resume(rate);
    } catch (error) {
      this.fail(error, generation);
    }
  }
}
