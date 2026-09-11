# Test fixtures

`continuous.mp3` is a synthetic 440 Hz sine wave generated for the browser playback regression. It contains no recorded speech or third-party audio. It is excluded from the APK and offline app assets.

Generate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:duration=120:sample_rate=8000' -ac 1 -codec:a libmp3lame -b:a 8k -metadata title='Synthetic MP3 playback test' continuous.mp3
```

`homework.docx` is a synthetic, compressed Word document created with python-docx. It contains five bilingual entries, split formatting runs, a tab, a three-column table with reversed English/Chinese columns, an ampersand, manual line breaks, a header and a footer. Tests verify imported content/order, header/footer exclusion, decompression limits and CRC validation. It contains no personal data and is excluded from the APK and offline assets.
