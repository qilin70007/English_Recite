package com.qilin.englishrecite;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.webkit.WebView;
import android.util.Base64;
import org.json.JSONObject;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Device-level checks for WebView lifecycle, native timers, service and real MP3. */
public class PlaybackInstrumentation extends Instrumentation {
    private MainActivity activity;
    private WebView webView;

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

    private String evaluate(String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        runOnMainSync(() -> webView.evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        if (!latch.await(15, TimeUnit.SECONDS)) throw new AssertionError("WebView stopped executing JavaScript");
        return result.get();
    }

    private void expect(String script, String message) throws Exception {
        if (!"true".equals(evaluate("Boolean(" + script + ")"))) throw new AssertionError(message + ": " + evaluate(script));
    }

    private void until(String script) throws Exception {
        long end = System.currentTimeMillis() + 20000;
        do {
            String setupError = evaluate("window.lockError || ''");
            if (!"\"\"".equals(setupError) && !"null".equals(setupError)) throw new AssertionError("Playback setup: " + setupError);
            if ("true".equals(evaluate("Boolean(" + script + ")"))) return;
            Thread.sleep(150);
        } while (System.currentTimeMillis() < end);
        throw new AssertionError("Timed out: " + script);
    }

    private void shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = getUiAutomation().executeShellCommand(command);
             InputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            while (stream.read() != -1) { }
        }
    }

    private JSONObject nativeState() throws Exception { return new JSONObject(activity.listPlaybackState()); }

    private JSONObject untilNative(java.util.function.Predicate<JSONObject> condition) throws Exception {
        long end = System.currentTimeMillis() + 25000;
        do {
            JSONObject state = nativeState();
            if (!state.optString("error").isEmpty()) throw new AssertionError(state.toString());
            if (condition.test(state)) return state;
            Thread.sleep(150);
        } while (System.currentTimeMillis() < end);
        throw new AssertionError("Native queue timed out: " + nativeState());
    }

    private void lockAndFreezeWebTimers() throws Exception {
        shell("input keyevent KEYCODE_SLEEP");
        runOnMainSync(() -> { webView.onPause(); webView.pauseTimers(); });
    }

    private void unlock() throws Exception {
        shell("input keyevent KEYCODE_WAKEUP");
        shell("wm dismiss-keyguard");
        runOnMainSync(() -> { webView.resumeTimers(); webView.onResume(); });
    }

    private String encodedAsset(String name) throws Exception {
        try (InputStream stream = getContext().getAssets().open(name)) {
            return Base64.encodeToString(stream.readAllBytes(), Base64.NO_WRAP);
        }
    }

    private void storeAudio(String key, String asset, String destination) throws Exception {
        String encoded = encodedAsset(asset);
        evaluate("window.lockReload=true;(async()=>{const {saveAudio}=await import(new URL('./audio-store.js',location.href).href);const bytes=Uint8Array.from(atob(" + JSONObject.quote(encoded) + "),c=>c.charCodeAt(0));const audio=await saveAudio(" + JSONObject.quote(key) + ",new File([bytes],'test.mp3',{type:'audio/mpeg'}));const s=JSON.parse(localStorage.getItem('englishRecite.state.v1'));" + destination + ";localStorage.setItem('englishRecite.state.v1',JSON.stringify(s));location.reload();})().catch(e=>window.lockError=String(e.stack||e));");
        until("typeof window.lockReload==='undefined' && document.getElementById('activeAssignmentTitle')?.textContent==='锁屏测试'");
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            webView = activity.findViewById(R.id.web_view);
            until("document.getElementById('todayReviewButton')");
            evaluate("localStorage.setItem('englishRecite.state.v1',JSON.stringify({activeAssignmentId:'lock',settings:{autoSpeak:false,repeat:1,playbackMode:'recall',answerWait:3},assignments:[{id:'lock',title:'锁屏测试',items:[{id:'one',prompt:'名称',answer:'name',status:'fuzzy'},{id:'two',prompt:'朋友',answer:'friend',status:'unknown'},{id:'three',prompt:'科学',answer:'science',status:'fuzzy'}]}]}));location.reload();");
            until("document.getElementById('activeAssignmentTitle')?.textContent==='锁屏测试'");
            until("String(window.AndroidTts.getStatus()).includes('ready:com.qilin.englishrecite.debug.test')");
            // No JavaScript TTS mock: Android's test voice synthesizes PCM and the
            // real TextToSpeech completion/focus path advances the native queue.
            evaluate("window.lockMarker=17;document.getElementById('startStudyButton').click();document.getElementById('continuousPlayButton').click();");
            untilNative(s -> s.optBoolean("playing") && s.optString("phase").equals("wait"));
            lockAndFreezeWebTimers();
            Thread.sleep(65000);
            JSONObject state = nativeState();
            if (!state.optBoolean("playing") || state.optInt("completed") < 9) throw new AssertionError("Recall must loop without web timers: " + state);
            unlock();
            untilNative(s -> s.optString("phase").equals("wait"));
            evaluate("document.dispatchEvent(new Event('visibilitychange'));");
            expect("window.lockMarker===17", "unlock must not reload");
            state = nativeState();
            expect("document.getElementById('studyCounter').textContent==='" + (state.optInt("index") + 1) + " / 3'", "card mirrors native playback on unlock");
            lockAndFreezeWebTimers();
            runOnMainSync(() -> getTargetContext().startService(new Intent(getTargetContext(), PlaybackService.class).setAction(PlaybackService.STOP)));
            untilNative(s -> !s.optBoolean("playing"));
            int completed = nativeState().optInt("completed");
            Thread.sleep(3700);
            if (nativeState().optInt("completed") != completed) throw new AssertionError("Stop must cancel recall deadline");
            unlock();
            until("document.getElementById('continuousPlayButton').getAttribute('aria-pressed')==='false'");

            storeAudio("item:one", "item.mp3", "s.assignments[0].items[0].audio=audio;s.settings.playbackMode='follow';s.settings.repeat=2");
            evaluate("document.getElementById('startStudyButton').click();document.getElementById('studyStatusFilter').value='fuzzy';document.getElementById('continuousPlayButton').click();");
            untilNative(s -> s.optBoolean("playing") && s.optString("source").equals("mp3"));
            if (nativeState().optInt("count") != 2) throw new AssertionError("Only the filtered two entries should play");
            lockAndFreezeWebTimers();
            Thread.sleep(18000);
            state = nativeState();
            if (!state.optBoolean("playing") || state.optInt("completed") < 4 || state.optInt("count") != 2)
                throw new AssertionError("Per-item MP3/TTS and repeat must loop while locked: " + state);
            runOnMainSync(() -> getTargetContext().startService(new Intent(getTargetContext(), PlaybackService.class).setAction(PlaybackService.STOP)));
            untilNative(s -> !s.optBoolean("playing"));
            unlock();
            until("document.getElementById('continuousPlayButton').getAttribute('aria-pressed')==='false'");
            expect("JSON.parse(localStorage.getItem('englishRecite.state.v1')).assignments[0].items.every(i=>!i.reviewCount)", "listening never grades entries");

            storeAudio("assignment:lock", "continuous.mp3", "s.assignments[0].audio=audio");
            evaluate("const OriginalAudio=window.Audio;window.Audio=function(src){window.lockAudio=new OriginalAudio(src);return window.lockAudio;};document.getElementById('startStudyButton').click();document.getElementById('assignmentMp3Button').click();");
            until("window.lockAudio?.currentTime>0.2");
            shell("input keyevent KEYCODE_HOME");
            Thread.sleep(1000);
            shell("input keyevent KEYCODE_SLEEP");
            Thread.sleep(3500);
            expect("window.lockAudio && !window.lockAudio.paused && window.lockAudio.currentTime>3", "whole MP3 continues in background");
            expect("document.getElementById('studyCounter').textContent==='1 / 3'", "whole MP3 does not change cards");
            evaluate("window.lockAudio.currentTime=window.lockAudio.duration-0.15;");
            Thread.sleep(1200);
            expect("window.lockAudio.loop && !window.lockAudio.paused && window.lockAudio.currentTime<3", "whole MP3 loops");
            runOnMainSync(() -> getTargetContext().startService(new Intent(getTargetContext(), PlaybackService.class).setAction(PlaybackService.STOP)));
            until("window.lockAudio.paused");
            unlock();
            result.putString("stream", "\nBackground playback checks passed: real Android TTS callbacks, frozen web timers, native recall loop, filtered per-item MP3/TTS, card sync and notification stop.\n");
            finish(-1, result);
        } catch (Throwable error) {
            result.putString("stream", "\nBACKGROUND PLAYBACK FAILED: " + android.util.Log.getStackTraceString(error));
            finish(0, result);
        }
    }
}
