import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function runRangeFullscreenChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.queues = []; window.queueStops = 0; window.displayCalls = [];
    window.AndroidList = { prepare: () => true, stop() { window.queueStops++; }, start(run, json) { window.queues.push(JSON.parse(json)); } };
    window.AndroidDisplay = { setCardFullscreen(value) { window.displayCalls.push(value); } };
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(baseURL);
    await page.evaluate(() => localStorage.setItem('englishRecite.state.v1', JSON.stringify({ activeAssignmentId: 'a', settings: { autoSpeak: false, alwaysShowAnswer: true }, assignments: [
      { id: 'a', title: '大作业本 · 103 个单词', items: Array.from({ length: 103 }, (_, i) => ({ id: `w${i + 1}`,
        prompt: i === 60 ? Array.from({ length: 25 }, (_, j) => `长内容第${j + 1}行`).join('\n') : `第${i + 1}个单词`,
        answer: i === 60 ? 'The full answer remains available.\nLast line of the answer.' : `Word ${i + 1}`,
        status: (i + 1) % 10 === 0 ? 'fuzzy' : 'mastered', difficult: (i + 1) % 20 === 0,
      })) }, { id: 'b', title: '另一份作业', items: [{ id: 'b1', prompt: '其他', answer: 'Other' }] },
    ] })));
    await page.reload();
    await page.locator('.mobile-nav [data-view-target=library]').click();
    await page.locator('[data-assignment-action=group][data-assignment-id=a]').click();
    assert.deepEqual(await page.locator('[data-range-start]').allTextContents(), ['1–20', '21–40', '41–60', '61–80', '81–100', '101–103']);
    await page.locator('[data-range-start="101"]').click();
    assert.equal(await page.locator('#rangeEndInput').inputValue(), '103');
    await page.locator('#rangeStartInput').fill('60');
    assert.equal(await page.locator('#rangeEndInput').inputValue(), '79');
    await page.locator('#rangeEndInput').fill('59');
    assert.equal(await page.locator('#startRangeStudyButton').isDisabled(), true);
    await page.locator('#rangeEndInput').fill('79');
    await page.screenshot({ path: resolve(shots, 'group-range-mobile.png'), animations: 'disabled' });
    await page.locator('#startRangeStudyButton').click();
    assert.equal(await page.locator('#answerText').textContent(), 'Word 60');
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 20');
    assert.match(await page.locator('#studyRangeSummary').textContent(), /60–79/);
    assert.equal(await page.locator('#enterCardFullscreenButton').isVisible(), false);
    const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('englishRecite.state.v1')).assignments);
    await page.locator('#continuousPlayButton').click();
    await page.waitForFunction(() => window.queues.length === 1);
    assert.deepEqual(await page.evaluate(() => window.queues[0].items.map(i => i.id)), Array.from({ length: 20 }, (_, i) => `w${i + 60}`));
    await page.setViewportSize({ width: 812, height: 375 });
    await page.locator('#enterCardFullscreenButton').click();
    const stops = await page.evaluate(() => window.queueStops);
    assert.equal(await page.locator('#continuousPlayButton').getAttribute('aria-pressed'), 'true');
    for (const selector of ['.topbar', '.sidebar', '.mobile-nav', '.study-filter-bar']) assert.equal(await page.locator(selector).isVisible(), false, selector);
    const layout = await page.evaluate(() => {
      const card = document.querySelector('#reciteCard').getBoundingClientRect();
      const exit = document.querySelector('#exitCardFullscreenButton').getBoundingClientRect();
      return { styles: ['.workspace', '.study-stage', '#reciteCard'].map(s => { const e = document.querySelector(s), c = getComputedStyle(e); return { selector: s, padding: c.padding, margin: c.margin, width: c.width, boxSizing: c.boxSizing }; }), card: { x: card.x, y: card.y, width: card.width, height: card.height }, exit: { bottom: exit.bottom, right: exit.right }, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    console.log('Fullscreen layout:', JSON.stringify(layout));
    await page.screenshot({ path: resolve(shots, 'fullscreen-card-landscape.png'), animations: 'disabled' });
    assert.ok(layout.card.width >= layout.width - 20 && layout.card.height >= layout.height * .7, JSON.stringify(layout));
    assert.ok(layout.exit.right <= layout.width && layout.exit.bottom < layout.height);
    assert.equal(layout.overflow, false);
    assert.ok(await page.locator('#nextItemButton').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight), 'full screen footer fits the viewport');
    await page.screenshot({ path: resolve(shots, 'fullscreen-card-landscape.png'), animations: 'disabled' });
    await page.locator('#exitCardFullscreenButton').click();
    assert.equal(await page.evaluate(() => window.queueStops), stops, 'exiting full screen does not interrupt playback');
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 20');
    await page.locator('#continuousPlayButton').click();
    await page.locator('#enterCardFullscreenButton').click();
    await page.locator('#nextItemButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '2 / 20');
    assert.ok(await page.locator('#cardReading').evaluate(e => e.scrollHeight > e.clientHeight));
    await page.locator('#cardReading').evaluate(e => { e.scrollTop = e.scrollHeight; });
    assert.ok(await page.locator('#exitCardFullscreenButton').evaluate(e => e.getBoundingClientRect().top >= 0));
    await page.screenshot({ path: resolve(shots, 'fullscreen-long-card-landscape.png'), animations: 'disabled' });
    await page.locator('#nextItemButton').click();
    assert.equal(await page.locator('#cardReading').evaluate(e => e.scrollTop), 0, 'a new word starts at the top');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').evaluate(e => e.classList.contains('card-fullscreen')), false);
    await page.locator('#enterCardFullscreenButton').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.body.classList.contains('card-fullscreen'));
    assert.equal(await page.locator('#studyCounter').textContent(), '3 / 20', 'rotation preserves the card');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('englishRecite.state.v1')).assignments), snapshot, 'grouping, playback and full screen do not grade words');
    await page.locator('#studyStatusFilter').selectOption('fuzzy');
    await page.locator('#applyStudyFilterButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 2');
    assert.equal(await page.locator('#answerText').textContent(), 'Word 60');
    await page.locator('#nextItemButton').click();
    assert.equal(await page.locator('#answerText').textContent(), 'Word 70');
    await page.locator('#onlyDifficultInput').check();
    await page.locator('#continuousPlayButton').click();
    await page.waitForFunction(() => window.queues.length === 2);
    assert.deepEqual(await page.evaluate(() => window.queues[1].items.map(i => i.id)), ['w60']);
    await page.locator('#continuousPlayButton').click();
    await page.locator('#clearStudyRangeButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 5');
    assert.equal(await page.locator('#answerText').textContent(), 'Word 20', 'clearing the range retains other filters');
    await page.locator('#studyRangeButton').click();
    await page.locator('#rangeDifficultInput').uncheck();
    await page.locator('#rangeStatusSelect').selectOption('all');
    await page.locator('#rangeSizeInput').fill('30');
    assert.equal(await page.locator('[data-range-start="91"]').textContent(), '91–103');
    await page.locator('[data-range-start="91"]').click();
    await page.locator('#startRangeStudyButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 13');
    assert.equal(await page.locator('#answerText').textContent(), 'Word 91');
    await page.reload();
    await page.locator('#startStudyButton').click();
    await page.locator('#studyRangeButton').click();
    assert.equal(await page.locator('#rangeSizeInput').inputValue(), '30', 'preferred group size survives reload');
    await page.locator('#studyRangeForm [data-close-dialog]').first().click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 103', 'cancel does not change the session');

    // Browser request rejection still offers the card-only layout and an exit.
    await page.evaluate(() => { delete window.AndroidDisplay; document.documentElement.requestFullscreen = () => Promise.reject(new Error('denied')); });
    await page.setViewportSize({ width: 640, height: 360 });
    await page.locator('#enterCardFullscreenButton').click();
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    await page.locator('#exitCardFullscreenButton').click();
    assert.equal(await page.locator('.sidebar').isVisible(), true);
  } finally { await context.close(); }
}
