# Audio fixture

`continuous.mp3` is a synthetic 440 Hz sine wave generated for the browser playback regression. It contains no recorded speech or third-party audio. It is excluded from the APK and offline app assets.

Generate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:duration=120:sample_rate=8000' -ac 1 -codec:a libmp3lame -b:a 8k -metadata title='Synthetic MP3 playback test' continuous.mp3
```
