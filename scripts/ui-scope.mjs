import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function runScopeChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.queues = [];
    window.AndroidList = { prepare: () => true, stop() {}, start(run, json) { window.queues.push(JSON.parse(json)); } };
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(baseURL);
    await page.evaluate(() => localStorage.setItem('englishRecite.state.v1', JSON.stringify({ activeAssignmentId: 'a', settings: { autoSpeak: false, alwaysShowAnswer: true }, assignments: [
      { id: 'a', title: '10月1日 单词', items: [
        { id: 'a1', prompt: '名称', answer: 'name', status: 'mastered', difficult: true },
        { id: 'a2', prompt: '班级', answer: 'class', status: 'unknown', difficult: false },
      ] },
      { id: 'b', title: '10月2日 不选这份', items: [{ id: 'b1', prompt: '朋友', answer: 'friend', status: 'unknown', difficult: true }] },
      { id: 'c', title: '10月3日 短语', audio: { name: 'whole.mp3', size: 10 }, items: [
        { id: 'c1', prompt: '努力学习', answer: 'study hard', status: 'fuzzy', difficult: true },
        { id: 'c2', prompt: '新的一天', answer: 'a new day', status: 'mastered', difficult: false },
      ] },
    ] })));
    await page.reload();
    const library = () => page.locator('.mobile-nav [data-view-target=library]').click();
    await library();
    assert.equal(await page.locator('#studySelectedButton').isDisabled(), true);
    await page.locator('[name=libraryNotebook][value=c]').check();
    await page.locator('[name=libraryNotebook][value=a]').check();
    assert.match(await page.locator('#librarySelectionSummary').textContent(), /已选 2 份 · 4 条 · 重难点 2 条/);
    await page.locator('#librarySelectionBar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(shots, 'multi-notebook-library.png') });
    await page.locator('#studySelectedButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 4');
    for (const answer of ['name', 'class', 'study hard', 'a new day']) {
      assert.equal(await page.locator('#answerText').textContent(), answer, 'selection order cannot reorder imported content');
      if (answer !== 'a new day') await page.locator('#nextItemButton').click();
    }
    assert.match(await page.locator('#studyAssignmentTitle').textContent(), /已选 2 份 · 10月3日/);
    assert.equal(await page.locator('#assignmentMp3Button').isDisabled(), true, 'do not pick an arbitrary whole MP3 for two notebooks');
    await library();
    await page.locator('#studySelectedDifficultButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 2');
    assert.equal(await page.locator('#answerText').textContent(), 'name', 'mastered starred word is retained');
    assert.equal(await page.locator('#onlyDifficultInput').isChecked(), true);
    await page.locator('#continuousPlayButton').click();
    await page.waitForFunction(() => window.queues.length === 1);
    assert.deepEqual(await page.evaluate(() => window.queues[0].items.map(i => i.id)), ['a1', 'c1'], 'native loop receives only the selected difficulty queue');
    await page.locator('#continuousPlayButton').click();
    await page.locator('#studyStatusFilter').selectOption('fuzzy');
    await page.locator('#applyStudyFilterButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 1');
    assert.equal(await page.locator('#answerText').textContent(), 'study hard');
    assert.equal(await page.locator('#assignmentMp3Button').isDisabled(), false, 'a filtered queue from one notebook has an unambiguous MP3');

    await page.locator('#studyStatusFilter').selectOption('all');
    await page.locator('#onlyDifficultInput').uncheck();
    await page.locator('#selectStudyScopeButton').click();
    assert.equal(await page.locator('[name=studyNotebook]:checked').count(), 2);
    await page.locator('[data-scope-select=none]').click();
    assert.equal(await page.locator('#confirmStudyScopeButton').isDisabled(), true);
    await page.locator('[name=studyNotebook][value=b]').check();
    await page.locator('#studyScopeForm [data-close-dialog=studyScopeDialog]').last().click();
    assert.equal(await page.locator('#studyScopeSelect').inputValue(), 'selected', 'cancel preserves previous scope');
    await page.locator('#selectStudyScopeButton').click();
    assert.equal(await page.locator('[name=studyNotebook][value=b]').isChecked(), false);
    await page.screenshot({ path: resolve(shots, 'multi-notebook-scope.png') });
    await page.locator('[data-scope-select=all]').click();
    await page.locator('[name=studyNotebook][value=a]').uncheck();
    await page.locator('#confirmStudyScopeButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 3');
    assert.equal(await page.locator('#answerText').textContent(), 'friend');
    await page.locator('#studyScopeSelect').selectOption('all');
    await page.locator('#applyStudyFilterButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 5');
    await library();
    await page.locator('#clearLibrarySelectionButton').click();
    assert.equal(await page.locator('[name=libraryNotebook]:checked').count(), 0);
    await page.locator('#selectAllLibraryButton').click();
    assert.equal(await page.locator('[name=libraryNotebook]:checked').count(), 3);
    page.on('dialog', dialog => dialog.accept());
    await page.locator('[data-assignment-action=delete][data-assignment-id=b]').click();
    assert.match(await page.locator('#librarySelectionSummary').textContent(), /已选 2 份 · 4 条/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile layout does not overflow');
  } finally { await context.close(); }
}
