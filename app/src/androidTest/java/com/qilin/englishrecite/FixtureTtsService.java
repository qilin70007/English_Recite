package com.qilin.englishrecite;

import android.media.AudioFormat;
import android.speech.tts.SynthesisCallback;
import android.speech.tts.SynthesisRequest;
import android.speech.tts.TextToSpeech;
import android.speech.tts.TextToSpeechService;
import android.speech.tts.Voice;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Instrumentation-only voice engine: real Android synthesis/audio callbacks,
 * deterministic tones instead of downloads or emulator-specific voice packs. */
public class FixtureTtsService extends TextToSpeechService {
    private volatile boolean stopped;
    @Override protected int onIsLanguageAvailable(String language, String country, String variant) {
        return language.equals("eng") || language.equals("en") || language.equals("zho") || language.equals("zh")
                ? TextToSpeech.LANG_COUNTRY_AVAILABLE : TextToSpeech.LANG_NOT_SUPPORTED;
    }
    @Override protected String[] onGetLanguage() { return new String[]{"eng", "USA", ""}; }
    @Override protected int onLoadLanguage(String language, String country, String variant) {
        return onIsLanguageAvailable(language, country, variant);
    }
    @Override public List<Voice> onGetVoices() {
        return Arrays.asList(new Voice("test-en", Locale.US, Voice.QUALITY_HIGH, Voice.LATENCY_LOW, false, Collections.emptySet()),
                new Voice("test-zh", Locale.CHINA, Voice.QUALITY_HIGH, Voice.LATENCY_LOW, false, Collections.emptySet()));
    }
    @Override public int onLoadVoice(String voice) { return TextToSpeech.SUCCESS; }
    @Override public int onIsValidVoiceName(String voice) { return TextToSpeech.SUCCESS; }
    @Override public String onGetDefaultVoiceNameFor(String language, String country, String variant) {
        return language.startsWith("zh") ? "test-zh" : "test-en";
    }
    @Override protected void onStop() { stopped = true; }
    @Override protected void onSynthesizeText(SynthesisRequest request, SynthesisCallback callback) {
        stopped = false;
        android.util.Log.i("ReciteFixtureTts", request.getCharSequenceText().toString());
        callback.start(16000, AudioFormat.ENCODING_PCM_16BIT, 1);
        byte[] pcm = new byte[6400]; // 200 ms, fed through Android's real audio track.
        for (int i = 0; i < pcm.length / 2; i++) {
            short sample = (short) (Math.sin(2 * Math.PI * 440 * i / 16000) * 500);
            pcm[i * 2] = (byte) sample; pcm[i * 2 + 1] = (byte) (sample >> 8);
        }
        for (int offset = 0; offset < pcm.length && !stopped; offset += callback.getMaxBufferSize()) {
            callback.audioAvailable(pcm, offset, Math.min(callback.getMaxBufferSize(), pcm.length - offset));
        }
        callback.done();
    }
}
