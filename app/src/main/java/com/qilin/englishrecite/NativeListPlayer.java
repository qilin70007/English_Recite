package com.qilin.englishrecite;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** The Android queue owns every transition. WebView events only mirror its state. */
final class NativeListPlayer {
    interface Host {
        void speak(String text, String language, float rate, String voice, String id);
        void stopSpeech();
        boolean requestFocus();
        void stateChanged(String state);
        void ended();
    }

    private final Context context;
    private final Host host;
    private final Handler clock = new Handler(Looper.getMainLooper());
    private JSONArray items = new JSONArray();
    private JSONObject settings = new JSONObject();
    private File audioFolder;
    private String run = "", phase = "idle", source = "", speechId;
    private volatile boolean playing;
    private int index, step, generation, sequence, completed;
    private long deadline;
    private MediaPlayer audio;
    private List<Step> steps = new ArrayList<>();
    private volatile String snapshot = "{}";

    private static final class Step {
        final String phase, text, language, voice;
        final float rate;
        final long delay;
        final File file;
        Step(String phase, String text, String language, float rate, String voice, long delay, File file) {
            this.phase = phase; this.text = text; this.language = language; this.rate = rate;
            this.voice = voice; this.delay = delay; this.file = file;
        }
    }

    NativeListPlayer(Context context, Host host) { this.context = context; this.host = host; }
    boolean isPlaying() { return playing; }
    String runId() { return run; }
    String getState() { return snapshot; }

    void start(String id, JSONObject payload, File folder) throws Exception {
        stop();
        items = payload.getJSONArray("items");
        if (items.length() == 0) throw new IllegalArgumentException("Empty list");
        settings = payload;
        run = id;
        audioFolder = folder;
        index = Math.max(0, Math.min(items.length() - 1, payload.optInt("index")));
        playing = true;
        completed = 0;
        sequence = 0;
        playItem();
    }

    void seek(String id, int target) {
        if (!playing || !run.equals(id)) return;
        cancelStep();
        index = Math.floorMod(target, items.length());
        playItem();
    }

    void stop() {
        if (!playing) return;
        playing = false;
        cancelStep();
        phase = "idle";
        deadline = 0;
        publish("");
        host.ended();
    }

    private void fail(String message) {
        playing = false;
        cancelStep();
        phase = "idle";
        deadline = 0;
        publish(message);
        host.ended();
    }

    private void cancelStep() {
        generation++;
        speechId = null;
        clock.removeCallbacksAndMessages(null);
        releaseAudio();
        host.stopSpeech();
    }

    private void releaseAudio() {
        if (audio == null) return;
        audio.setOnCompletionListener(null);
        audio.setOnErrorListener(null);
        audio.setOnPreparedListener(null);
        audio.release();
        audio = null;
    }

    private float rate() { return (float) Math.max(0.5, Math.min(2, settings.optDouble("rate", 0.85))); }

    private void addSpeech(JSONArray segments, String currentPhase, int repeats) {
        if (segments == null) return;
        for (int repeat = 0; repeat < repeats; repeat++) {
            for (int i = 0; i < segments.length(); i++) {
                JSONObject s = segments.optJSONObject(i);
                if (s == null || s.optString("text").trim().isEmpty()) continue;
                String language = s.optString("language", "en-US");
                boolean chinese = language.startsWith("zh");
                steps.add(new Step(currentPhase, s.optString("text"), language, chinese ? 1 : rate(),
                        settings.optString(chinese ? "chineseVoiceURI" : "voiceURI"), 0, null));
                if (i < segments.length() - 1) steps.add(new Step(currentPhase, null, null, 1, null, 60, null));
            }
            if (repeat < repeats - 1) steps.add(new Step(currentPhase, null, null, 1, null, 400, null));
        }
    }

    private void playItem() {
        if (!playing) return;
        steps = new ArrayList<>();
        JSONObject item = items.optJSONObject(index);
        if (item == null) { fail("清单内容无法读取，请重新开始。"); return; }
        JSONArray prompt = item.optJSONArray("prompt"), answer = item.optJSONArray("answer");
        boolean hasPrompt = prompt != null && prompt.length() > 0;
        boolean recall = settings.optBoolean("recall") && hasPrompt;
        if (hasPrompt) addSpeech(prompt, recall ? "prompt" : "answer", 1);
        if (recall) {
            int seconds = settings.optInt("answerWait", 5);
            if (seconds != 3 && seconds != 5 && seconds != 10 && seconds != 20 && seconds != 30) seconds = 5;
            steps.add(new Step("wait", null, null, 1, null, seconds * 1000L, null));
        }
        int repeat = Math.max(1, Math.min(3, settings.optInt("repeat", 1)));
        File file = new File(audioFolder, index + ".mp3");
        if (item.optBoolean("audio") && file.isFile() && file.length() > 0) {
            for (int i = 0; i < repeat; i++) steps.add(new Step("answer", null, null, rate(), null, 0, file));
        } else addSpeech(answer, "answer", repeat);
        step = 0;
        nextStep();
    }

    private void nextStep() {
        if (!playing) return;
        if (step >= steps.size()) {
            completed++;
            index = (index + 1) % items.length();
            JSONObject next = items.optJSONObject(index);
            phase = settings.optBoolean("recall") && next.optJSONArray("prompt").length() > 0 ? "prompt" : "answer";
            deadline = 0;
            publish("");
            int token = generation;
            clock.postDelayed(() -> { if (playing && generation == token) playItem(); }, 420);
            return;
        }
        Step current = steps.get(step++);
        phase = current.phase;
        source = current.file != null ? "mp3" : current.text != null ? "tts" : "wait";
        deadline = "wait".equals(phase) ? System.currentTimeMillis() + current.delay : 0;
        publish("");
        int token = generation;
        if (current.delay > 0) {
            clock.postDelayed(() -> { if (playing && generation == token) nextStep(); }, current.delay);
        } else if (current.file != null) {
            playAudio(current, token);
        } else {
            speechId = "list-" + run + "-" + generation + "-" + sequence;
            host.speak(current.text, current.language, current.rate, current.voice, speechId);
        }
    }

    private void playAudio(Step current, int token) {
        try {
            if (!host.requestFocus()) { fail("其他应用正在使用音频，请稍后重新播放。"); return; }
            audio = new MediaPlayer();
            MediaPlayer player = audio;
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK);
            player.setDataSource(current.file.getAbsolutePath());
            player.setOnPreparedListener(p -> {
                if (!playing || generation != token || audio != p) return;
                try {
                    p.setPlaybackParams(p.getPlaybackParams().setSpeed(current.rate));
                    p.start();
                } catch (RuntimeException error) { audioFailed(token); }
            });
            player.setOnCompletionListener(p -> {
                if (!playing || generation != token || audio != p) return;
                releaseAudio();
                nextStep();
            });
            player.setOnErrorListener((p, what, extra) -> { audioFailed(token); return true; });
            player.prepareAsync();
        } catch (Exception error) { audioFailed(token); }
    }

    private void audioFailed(int token) {
        if (!playing || generation != token) return;
        releaseAudio();
        // Keep imported audio metadata intact. Fall back to this item's TTS only.
        steps = new ArrayList<>();
        addSpeech(items.optJSONObject(index).optJSONArray("answer"), "answer", Math.max(1, Math.min(3, settings.optInt("repeat", 1))));
        step = 0;
        nextStep();
    }

    boolean speechFinished(String id, boolean success) {
        if (id == null || !id.startsWith("list-")) return false;
        clock.post(() -> {
            if (!playing || !id.equals(speechId)) return;
            speechId = null;
            if (success) nextStep();
            else fail("朗读未成功，请在设置中检查普通话和英语语音包。");
        });
        return true;
    }

    private void publish(String error) {
        try {
            snapshot = new JSONObject().put("run", run).put("playing", playing).put("index", index)
                    .put("itemId", items.optJSONObject(index).optString("id")).put("phase", phase)
                    .put("deadline", deadline).put("sequence", ++sequence).put("completed", completed)
                    .put("source", source).put("count", items.length())
                    .put("error", error).toString();
            host.stateChanged(snapshot);
        } catch (Exception ignored) { }
    }
}
