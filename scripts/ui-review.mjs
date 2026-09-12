import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openZip } from "../archive.js";

export async function runReviewChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.voicesRead = [];
    window.playbackStates = [];
    const timers = new Map();
    window.AndroidPlayback = {
      setActive: (active) => window.playbackStates.push(active),
      schedule(id, ms) { timers.set(id, setTimeout(() => { timers.delete(id); window.dispatchEvent(new CustomEvent("native-playback-timer", { detail: { id } })); }, ms)); },
      cancel(id) { clearTimeout(timers.get(id)); timers.delete(id); },
    };
    window.AndroidTts = {
      getStatus: () => "ready:test", getVoices: () => "[]", speakLocalized() {}, stop() {},
      speakWithVoice(text, lang, rate, repeat, id) { window.voicesRead.push({ text, lang, id }); },
    };
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseURL);
    await page.evaluate(() => localStorage.setItem("englishRecite.state.v1", JSON.stringify({
      activeAssignmentId: "a", settings: { autoSpeak: false, repeat: 1 }, assignments: [
        { id: "a", title: "今天的单词", items: [
          { id: "a1", prompt: "名称", answer: "name", note: "name is the answer", status: "mastered", difficult: true },
          { id: "a2", prompt: "朋友", answer: "friend", status: "unknown" },
          { id: "a3", prompt: "", answer: "science", status: "new" },
        ] },
        { id: "b", title: "稍后再加入的作业", items: [{ id: "b1", prompt: "班级", answer: "class", status: "fuzzy" }] },
      ],
    })));
    await page.reload();
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("englishRecite.state.v1")));
    assert.equal((await state()).assignments[0].items[1].difficult, true, "legacy weak entries migrate");
    await page.locator('#todayReviewButton').click();
    assert.equal(await page.locator('[name=reviewNotebook][value=a]').isChecked(), true);
    assert.equal(await page.locator('[name=reviewNotebook][value=b]').isChecked(), false);
    await page.screenshot({ path: resolve(shots, 'review-plan-mobile.png') });
    await page.locator('#reviewPlanForm [type=submit]').click();
    assert.match(await page.locator('#todayReviewButton').textContent(), /2 条/);
    await page.screenshot({ path: resolve(shots, 'today-review-mobile.png') });
    await page.locator('#todayReviewButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 2');
    const unchanged = (await state()).assignments[0].items[0].review;
    await page.locator('#answerPanel').click();
    assert.deepEqual((await state()).assignments[0].items[0].review, unchanged, "revealing is not a review grade");
    await page.locator('[data-status=mastered]').click();
    await page.waitForFunction(() => document.querySelector('#studyCounter').textContent === '2 / 2');
    assert.equal((await state()).assignments[0].items[0].difficult, true, "mastery retains the star");
    await page.locator('[data-status=fuzzy]').click();
    await page.waitForFunction(() => document.querySelector('#completionDialog').open);
    assert.match(await page.locator('#todayReviewButton').textContent(), /0 条/);
    await page.locator('[data-close-completion]').click();

    await page.locator('#startStudyButton').click();
    await page.locator('#onlyDifficultInput').check();
    await page.locator('#applyStudyFilterButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 2');
    await page.locator('#difficultyButton').click();
    await page.locator('#applyStudyFilterButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 1');
    assert.equal(await page.locator('#promptText').textContent(), '朋友');
    await page.locator('#studyStatusFilter').selectOption('mastered');
    await page.locator('#applyStudyFilterButton').click();
    assert.match(await page.locator('#toast').textContent(), /没有符合/);
    await page.reload();
    assert.equal((await state()).assignments[0].items[0].difficult, false, "manual star removal persists");

    await page.locator('#settingsButton').click();
    await page.locator('#playbackModeSelect').selectOption('recall');
    await page.locator('#answerWaitSelect').selectOption('3');
    await page.locator('#settingsForm [type=submit]').click();
    await page.locator('#startStudyButton').click();
    await page.locator('#alwaysShowAnswerInput').check();
    await page.locator('#continuousPlayButton').click();
    const waitVoices = (n) => page.waitForFunction((n) => window.voicesRead.length === n, n);
    const finish = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('native-tts-done', { detail: { id: window.voicesRead.at(-1).id } })));
    await waitVoices(1);
    assert.equal(await page.locator('#answerText').isVisible(), false);
    assert.equal(await page.locator('#itemNote').isVisible(), false);
    assert.equal(await page.locator('#alwaysShowAnswerInput').isDisabled(), true);
    await finish();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.voicesRead.length), 1, 'answer does not play before wait ends');
    assert.match(await page.locator('#recallCountdown').textContent(), /请回忆/);
    await page.screenshot({ path: resolve(shots, 'recall-wait-mobile.png') });
    await waitVoices(2);
    assert.equal(await page.locator('#answerText').isVisible(), true);
    assert.equal(await page.evaluate(() => window.voicesRead[1].text), 'name');
    await finish(); await waitVoices(3);
    assert.equal(await page.locator('#studyCounter').textContent(), '2 / 3');
    await finish(); // Waiting for friend.
    await page.locator('#nextItemButton').click(); await waitVoices(4);
    assert.equal(await page.evaluate(() => window.voicesRead[3].text), 'science', 'no-prompt entries do not wait');
    await page.locator('#continuousPlayButton').click();
    await page.waitForTimeout(3300);
    assert.equal(await page.evaluate(() => window.voicesRead.length), 4, 'skipped countdown and stop cannot reveal old answers');
    assert.equal(await page.locator('#alwaysShowAnswerInput').isEnabled(), true);
    assert.equal(await page.locator('#alwaysShowAnswerInput').isChecked(), true);
    assert.equal(await page.evaluate(() => window.playbackStates.at(-1)), false);
    await page.locator('#previousItemButton').click();
    await page.locator('#continuousPlayButton').click(); await waitVoices(5);
    await finish();
    await page.evaluate(() => window.dispatchEvent(new Event('native-playback-stop')));
    await page.waitForTimeout(3300);
    assert.equal(await page.evaluate(() => window.voicesRead.length), 5, 'notification stop cancels a silent answer wait');
    assert.equal(await page.locator('#continuousPlayButton').getAttribute('aria-pressed'), 'false');

    await page.locator('.mobile-nav [data-view-target=library]').click();
    await page.locator('#exportWordButton').click();
    await page.locator('#wordLayoutSelect').selectOption('dictation');
    await page.screenshot({ path: resolve(shots, 'dictation-export-mobile.png') });
    const download = page.waitForEvent('download');
    await page.locator('#saveWordButton').click();
    const doc = await download;
    assert.match(doc.suggestedFilename(), /中文默写/);
    await doc.saveAs(resolve(shots, 'dictation-sample.docx'));
    const zip = await openZip(new Blob([await readFile(await doc.path())]));
    const xml = await (await zip.get('word/document.xml').read()).text();
    assert.match(xml, /朋友|班级/);
    assert.doesNotMatch(xml, /friend|class|science|name is the answer/);
    await page.locator('#exportWordButton').click();
    await page.locator('#wordLayoutSelect').selectOption('dictation');
    await page.locator('[name=wordStatus][value=new]').check();
    assert.match(await page.locator('#wordExportSummary').textContent(), /缺少中文提示/);
    assert.equal(await page.locator('#saveWordButton').isDisabled(), true);
  } finally { await context.close(); }
}
