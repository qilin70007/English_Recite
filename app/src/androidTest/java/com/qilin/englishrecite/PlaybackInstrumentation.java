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

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            webView = activity.findViewById(R.id.web_view);
            until("document.getElementById('todayReviewButton')");
            evaluate("localStorage.setItem('englishRecite.state.v1',JSON.stringify({activeAssignmentId:'lock',settings:{autoSpeak:false,repeat:1,playbackMode:'recall',answerWait:3},assignments:[{id:'lock',title:'锁屏测试',items:[{id:'one',prompt:'名称',answer:'name'},{id:'two',prompt:'朋友',answer:'friend'},{id:'three',prompt:'科学',answer:'science'}]}]}));location.reload();");
            until("document.getElementById('activeAssignmentTitle')?.textContent==='锁屏测试'");
            // Synthetic completions isolate lifecycle/timing from emulator voice-pack availability.
            evaluate("(async()=>{const {playbackDelay}=await import('./playback-clock.js');window.lockCalls=[];window.lockMarker=17;window.AndroidTts={getStatus:()=> 'ready:test',getVoices:()=> '[]',speakLocalized(){},stop(){},speakWithVoice(text,lang,rate,repeat,id){window.lockCalls.push(text);playbackDelay(()=>window.dispatchEvent(new CustomEvent('native-tts-done',{detail:{id}})),120);}};window.lockReady=true;})();");
            until("window.lockReady");
            evaluate("document.getElementById('startStudyButton').click();document.getElementById('continuousPlayButton').click();");
            until("window.lockCalls?.length===1");
            shell("input keyevent KEYCODE_SLEEP");
            Thread.sleep(8500);
            expect("window.lockCalls.length>=5", "native answer waits and card transitions must continue while locked");
            expect("document.getElementById('continuousPlayButton').getAttribute('aria-pressed')==='true'", "loop remains active");
            shell("input keyevent KEYCODE_WAKEUP");
            shell("wm dismiss-keyguard");
            expect("window.lockMarker===17", "unlock must not reload or reset the queue");
            evaluate("window.dispatchEvent(new Event('native-playback-stop'));");
            int calls = Integer.parseInt(evaluate("window.lockCalls.length"));
            Thread.sleep(3700);
            expect("window.lockCalls.length===" + calls, "stop cancels pending answer waits");

            String encoded;
            try (InputStream stream = getContext().getAssets().open("continuous.mp3")) {
                encoded = Base64.encodeToString(stream.readAllBytes(), Base64.NO_WRAP);
            }
            evaluate("(async()=>{const {saveAudio}=await import('./audio-store.js');const bytes=Uint8Array.from(atob(" + JSONObject.quote(encoded) + "),c=>c.charCodeAt(0));const audio=await saveAudio('assignment:lock',new File([bytes],'test.mp3',{type:'audio/mpeg'}));const s=JSON.parse(localStorage.getItem('englishRecite.state.v1'));s.assignments[0].audio=audio;localStorage.setItem('englishRecite.state.v1',JSON.stringify(s));location.reload();})();");
            until("typeof window.lockReady==='undefined' && document.getElementById('activeAssignmentTitle')?.textContent==='锁屏测试'");
            evaluate("const OriginalAudio=window.Audio;window.Audio=function(src){window.lockAudio=new OriginalAudio(src);return window.lockAudio;};document.getElementById('startStudyButton').click();document.getElementById('assignmentMp3Button').click();");
            until("window.lockAudio?.currentTime>0.2");
            shell("input keyevent KEYCODE_HOME");
            Thread.sleep(1000);
            shell("input keyevent KEYCODE_SLEEP");
            Thread.sleep(3500);
            expect("window.lockAudio && !window.lockAudio.paused && window.lockAudio.currentTime>3", "real MP3 continues in background with screen off");
            expect("document.getElementById('studyCounter').textContent==='1 / 3'", "MP3 does not change card position");
            evaluate("window.lockAudio.currentTime=window.lockAudio.duration-0.15;");
            Thread.sleep(1200);
            expect("window.lockAudio.loop && !window.lockAudio.paused && window.lockAudio.currentTime<3", "MP3 loops while locked");
            runOnMainSync(() -> getTargetContext().startService(new Intent(getTargetContext(), PlaybackService.class).setAction(PlaybackService.STOP)));
            until("window.lockAudio.paused");
            shell("input keyevent KEYCODE_WAKEUP");
            shell("wm dismiss-keyguard");
            result.putString("stream", "\nBackground playback checks passed: native countdown/card sync, lock/unlock, real MP3 loop and service stop.\n");
            finish(-1, result);
        } catch (Throwable error) {
            result.putString("stream", "\nBACKGROUND PLAYBACK FAILED: " + android.util.Log.getStackTraceString(error));
            finish(0, result);
        }
    }
}
