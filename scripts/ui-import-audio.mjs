import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createZip } from "../archive.js";

export async function runImportAudioChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.readEvents = [];
    window.cardAudios = [];
    window.AndroidTts = {
      getStatus: () => "ready:test", getVoices: () => "[]", speakLocalized() {}, stop() {},
      speakWithVoice(text, lang, rate, repeat, id) { window.readEvents.push({ text, lang, rate, id }); },
    };
    window.Audio = class {
      constructor(src) { this.src = src; window.cardAudios.push(this); }
      play() { window.readEvents.push({ mp3: true }); return Promise.resolve(); }
      pause() {} load() {} removeAttribute() {}
    };
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.locator('.mobile-nav [data-view-target=library]').click();
    await page.locator('.library-add-button').click();
    await page.locator('[data-import-tab=file]').click();
    assert.match(await page.locator('#contentFileInput').getAttribute('accept'), /\.docx/);
    await page.locator('#contentFileInput').setInputFiles(resolve('tests/fixtures/homework.docx'));
    await page.waitForFunction(() => !document.querySelector('#importPreview').hidden && !document.querySelector('#saveAssignmentButton').disabled);
    const draft = await page.locator('.preview-row').evaluateAll((rows) => rows.map((row) => ({
      prompt: row.querySelector('[data-preview-field=prompt]').value,
      answer: row.querySelector('[data-preview-field=answer]').value,
    })));
    assert.deepEqual(draft, [
      { prompt: '名称', answer: 'name' },
      { prompt: '我对科学感兴趣', answer: 'I am interested in science.' },
      { prompt: '友善的；乐于助人的', answer: 'kind & helpful' },
      { prompt: '我的学校。我们一起学习。', answer: 'This is my school. We learn together.' },
      { prompt: '谢谢', answer: 'Thank you.' },
    ]);
    await page.locator('.preview-row').first().screenshot({ path: resolve(shots, 'docx-review-mobile.png') });
    await page.locator('#saveAssignmentButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 5');
    assert.equal(await page.locator('#promptText').textContent(), '名称');

    // Strict namespace, split runs, manual line breaks, headings and a table in one labeled document.
    const xml = `<x:document xmlns:x="http://purl.oclc.org/ooxml/wordprocessingml/main"><x:body>
      <x:p><x:pPr><x:pStyle x:val="Title"/></x:pPr><x:r><x:t>9月11日英语背诵</x:t></x:r></x:p>
      <x:p><x:r><x:t>【中</x:t></x:r><x:r><x:t>文】课文</x:t></x:r></x:p>
      <x:p><x:r><x:t>【英文】I am Amy.</x:t><x:br/><x:t>We learn together.</x:t></x:r></x:p>
      <x:tbl><x:tr><x:tc><x:p><x:r><x:t>中文提示</x:t></x:r></x:p></x:tc><x:tc><x:p><x:r><x:t>英文</x:t></x:r></x:p></x:tc></x:tr>
      <x:tr><x:tc><x:p><x:r><x:t>同学</x:t></x:r></x:p></x:tc><x:tc><x:p><x:r><x:t>classmate</x:t></x:r></x:p></x:tc></x:tr></x:tbl>
      <x:p><x:del><x:r><x:delText>deleted words</x:delText></x:r></x:del></x:p>
    </x:body></x:document>`;
    const labeledDocx = await createZip([{ name: 'word/document.xml', blob: new Blob([xml]) }]);
    await page.locator('.mobile-nav [data-view-target=library]').click();
    await page.locator('.library-add-button').click();
    await page.locator('[data-import-tab=file]').click();
    await page.locator('#contentFileInput').setInputFiles({ name: '课文.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(await labeledDocx.arrayBuffer()) });
    await page.waitForFunction(() => !document.querySelector('#importPreview').hidden);
    assert.equal(await page.locator('.preview-row').count(), 2);
    assert.equal(await page.locator('[data-preview-field=answer]').first().inputValue(), 'I am Amy.\nWe learn together.');
    assert.equal(await page.locator('[data-preview-field=answer]').last().inputValue(), 'classmate');
    await page.locator('#contentFileInput').setInputFiles({ name: 'broken.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not a document') });
    await page.waitForFunction(() => !document.querySelector('#importError').hidden && !document.querySelector('#saveAssignmentButton').disabled);
    assert.match(await page.locator('#importError').textContent(), /DOCX/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('englishRecite.state.v1')).assignments.length), 1, 'failed DOCX import leaves saved notebooks intact');
    await page.locator('[data-close-dialog=importDialog]').first().click();

    // Control each native completion to prove prompt -> repeated answer -> next item order.
    await page.evaluate(async () => {
      const { saveAudio } = await import('./audio-store.js');
      const audio = await saveAudio('item:v3', new File(['test audio'], '词条.mp3', { type: 'audio/mpeg' }));
      localStorage.setItem('englishRecite.state.v1', JSON.stringify({ version: 2, activeAssignmentId: 'voice',
        settings: { autoSpeak: false, repeat: 2, rate: 0.7 }, assignments: [{ id: 'voice', title: '中文提示连续朗读', items: [
          { id: 'v1', prompt: '名称', answer: 'name' },
          { id: 'v2', prompt: '', answer: 'science' },
          { id: 'v3', prompt: '朋友', answer: 'friend', audio },
        ] }],
      }));
    });
    await page.reload();
    await page.locator('#startStudyButton').click();
    await page.locator('#continuousPlayButton').click();
    const waitCalls = (count) => page.waitForFunction((count) => window.readEvents.length === count, count);
    const finishVoice = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('native-tts-done', { detail: { id: window.readEvents.at(-1).id } })));
    await waitCalls(1);
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 3');
    await finishVoice(); await waitCalls(2);
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 3');
    await finishVoice(); await waitCalls(3);
    await finishVoice(); await waitCalls(4);
    assert.equal(await page.locator('#studyCounter').textContent(), '2 / 3');
    await finishVoice(); await waitCalls(5);
    await finishVoice(); await waitCalls(6);
    assert.equal(await page.locator('#studyCounter').textContent(), '3 / 3');
    await finishVoice(); await waitCalls(7);
    await page.evaluate(() => window.cardAudios.at(-1).onended()); await waitCalls(8);
    await page.evaluate(() => window.cardAudios.at(-1).onended());
    assert.match(await page.locator('#continuousPlayButton').textContent(), /连续朗读/);
    assert.deepEqual(await page.evaluate(() => window.readEvents.map(({ text, lang, rate, mp3 }) => mp3 ? { mp3 } : { text, lang, rate })), [
      { text: '名称', lang: 'zh-CN', rate: 1 }, { text: 'name', lang: 'en-US', rate: 0.7 }, { text: 'name', lang: 'en-US', rate: 0.7 },
      { text: 'science', lang: 'en-US', rate: 0.7 }, { text: 'science', lang: 'en-US', rate: 0.7 },
      { text: '朋友', lang: 'zh-CN', rate: 1 }, { mp3: true }, { mp3: true },
    ]);
    // Stopping during a prompt and quickly restarting cannot resume the old sequence.
    await page.locator('#applyStudyFilterButton').click();
    await page.evaluate(() => { window.readEvents = []; });
    await page.locator('#continuousPlayButton').click(); await waitCalls(1);
    const oldId = await page.evaluate(() => window.readEvents[0].id);
    await page.locator('#continuousPlayButton').click();
    await page.locator('#continuousPlayButton').click(); await waitCalls(2);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent('native-tts-done', { detail: { id } })), oldId);
    await finishVoice(); await waitCalls(3);
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 3');
    assert.deepEqual(await page.evaluate(() => window.readEvents.map((event) => event.text)), ['名称', '名称', 'name']);
    // Cancel the delayed English repeat; neither the repeat nor the next card may run.
    await finishVoice();
    await page.locator('#continuousPlayButton').click();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.readEvents.length), 3);
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 3');
  } finally { await context.close(); }
}
