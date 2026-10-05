import assert from 'node:assert/strict';

export async function runPronunciationChecks(browser, baseURL, errors) {
  for (const bridge of ['android', 'web']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript((bridge) => {
      window.spoken = []; window.spokenAt = [];
      if (bridge === 'android') {
        window.AndroidTts = {
          getStatus: () => 'ready:test', getVoices: () => '[]', speakLocalized() {}, stop() {},
          speakWithVoice(text, lang, rate, repeat, id) {
            window.spokenAt.push(performance.now()); window.spoken.push({ text, lang, rate });
            setTimeout(() => window.dispatchEvent(new CustomEvent('native-tts-done', { detail: { id } })), 20);
          },
        };
      } else {
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        Object.defineProperty(window, 'speechSynthesis', { value: {
          getVoices: () => [{ voiceURI: 'cn', name: '普通话', lang: 'zh-CN' }, { voiceURI: 'en', name: 'English', lang: 'en-US' }],
          speak(utterance) { window.spokenAt.push(performance.now()); window.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate }); setTimeout(() => utterance.onend?.(), 20); },
          cancel() {}, addEventListener() {},
        } });
      }
    }, bridge);
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseURL);
      await page.evaluate(() => localStorage.setItem('englishRecite.state.v1', JSON.stringify({ activeAssignmentId: 'a', settings: { autoSpeak: false, repeat: 1, rate: .7, alwaysShowAnswer: true }, assignments: [{ id: 'a', title: '朗读缩写', items: [
        { id: 'a1', prompt: 'n. 名称', answer: 'ask sb. to do sth.', status: 'fuzzy' },
        { id: 'a2', prompt: 'adv 快速地', answer: 'adv. quickly', status: 'unknown' },
      ] }] })));
      await page.reload();
      await page.locator('#startStudyButton').click();
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('englishRecite.state.v1')).assignments);
      await page.locator('#speakButton').click();
      await page.waitForFunction(() => window.spoken.length === 1 && !document.querySelector('#speakButton').classList.contains('speaking'));
      assert.deepEqual(await page.evaluate(() => window.spoken), [{ text: 'ask somebody to do something.', lang: 'en-US', rate: .7 }], `${bridge}: ordinary playback expands English placeholders`);
      assert.equal(await page.locator('#answerText').textContent(), 'ask sb. to do sth.');
      await page.locator('#nextItemButton').click();
      await page.evaluate(() => { window.spoken = []; window.spokenAt = []; });
      await page.locator('#speakButton').click();
      await page.waitForFunction(() => window.spoken.length === 2 && !document.querySelector('#speakButton').classList.contains('speaking'));
      assert.deepEqual(await page.evaluate(() => window.spoken), [{ text: '副词', lang: 'zh-CN', rate: 1 }, { text: 'quickly', lang: 'en-US', rate: .7 }], `${bridge}: labels use the Chinese voice even inside an answer`);
      assert.equal(await page.locator('#answerText').textContent(), 'adv. quickly');
      assert.ok(await page.evaluate(() => window.spokenAt[1] - window.spokenAt[0] >= 350), 'single playback pauses after POS');
      await page.locator('#previousItemButton').click();
      await page.evaluate(() => { window.spoken = []; window.spokenAt = []; });
      await page.locator('#continuousPlayButton').click();
      await page.waitForFunction(() => window.spoken.length >= 7);
      await page.locator('#continuousPlayButton').click();
      assert.deepEqual(await page.evaluate(() => window.spoken.slice(0, 7)), [
        { text: '名词', lang: 'zh-CN', rate: 1 },
        { text: '名称', lang: 'zh-CN', rate: 1 },
        { text: 'ask somebody to do something.', lang: 'en-US', rate: .7 },
        { text: '副词', lang: 'zh-CN', rate: 1 },
        { text: '快速地', lang: 'zh-CN', rate: 1 },
        { text: '副词', lang: 'zh-CN', rate: 1 },
        { text: 'quickly', lang: 'en-US', rate: .7 },
      ], `${bridge}: continuous playback normalizes both prompt and answer`);
      assert.ok(await page.evaluate(() => [0, 3, 5].every(i => window.spokenAt[i + 1] - window.spokenAt[i] >= 350)), 'continuous playback pauses after each label');
      await page.evaluate(() => { window.spoken = []; window.spokenAt = []; });
      await page.locator('#speakButton').click();
      await page.waitForFunction(() => window.spoken.length === 1);
      await page.locator('#speakButton').click();
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.spoken.length), 1, 'stopping during the pause prevents the following meaning');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('englishRecite.state.v1')).assignments), before, 'listening preserves original text and progress');
    } finally { await context.close(); }
  }
}
