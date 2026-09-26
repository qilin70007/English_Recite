import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function runSearchChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(baseURL);
    await page.evaluate(() => {
      localStorage.setItem('englishRecite.state.v1', JSON.stringify({ version: 3, activeAssignmentId: 'a', settings: { autoSpeak: false, alwaysShowAnswer: true }, assignments: [
        { id: 'a', title: '9月26日背诵', items: [
          { id: 'a1', prompt: '名称', answer: 'Name', status: 'unknown' },
          { id: 'a2', prompt: '一起学习\n每天进步', answer: 'We learn together.\nWe help each other.\nEnjoy learning every day.', status: 'fuzzy' },
          { id: 'a3', prompt: '标签 <b> & 中文', answer: '<script>literal</script>', status: 'new' },
        ] },
        { id: 'b', title: '另一份作业', items: [{ id: 'b1', prompt: '名字', answer: 'name', status: 'mastered' }] },
        { id: 'c', title: '大量内容', items: Array.from({ length: 45 }, (_, i) => ({ id: `c${i}`, prompt: `第${i}条`, answer: `Entry ${i}` })) },
      ] }));
    });
    await page.reload();
    const saved = await page.evaluate(() => localStorage.getItem('englishRecite.state.v1'));
    await page.locator('#searchButton').click();
    assert.equal(await page.locator('#searchInput').evaluate(e => e === document.activeElement), true);
    await page.locator('#searchInput').fill('NAME');
    assert.equal(await page.locator('.search-result').count(), 2);
    await page.locator('#searchScopeSelect').selectOption('b');
    assert.equal(await page.locator('.search-result').count(), 1);
    await page.locator('#searchScopeSelect').selectOption('all');
    await page.locator('#searchInput').fill('不存在的词');
    assert.match(await page.locator('#searchSummary').textContent(), /没有找到/);
    await page.locator('#clearSearchButton').click();
    assert.equal(await page.locator('.search-result').count(), 0);
    await page.locator('#searchInput').fill('大量内容');
    assert.equal(await page.locator('.search-result').count(), 40);
    await page.locator('#moreSearchButton').click();
    assert.equal(await page.locator('.search-result').count(), 45);
    await page.locator('#searchInput').fill('<b>');
    assert.equal(await page.locator('.search-result b, .search-result script').count(), 0);
    assert.match(await page.locator('.search-result').textContent(), /<script>literal<\/script>/);
    await page.locator('#searchInput').fill('学习');
    await page.screenshot({ path: resolve(shots, 'search-mobile.png'), animations: 'disabled' });
    assert.equal(await page.evaluate(() => localStorage.getItem('englishRecite.state.v1')), saved, 'searching does not modify progress');
    await page.locator('.search-result').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '2 / 3');
    assert.equal(await page.locator('#promptText').textContent(), '一起学习\n每天进步');
    assert.equal(await page.locator('#answerText').textContent(), 'We learn together.\nWe help each other.\nEnjoy learning every day.');
    await page.locator('#searchButton').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#searchDialog').evaluate(e => e.open), false);
    assert.equal(await page.locator('#studyCounter').textContent(), '2 / 3', 'closing search preserves current card');
    for (const viewport of [{ width: 640, height: 360 }, { width: 812, height: 375 }, { width: 960, height: 540 }, { width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { document.getAnimations().forEach(a => a.finish()); window.scrollTo(0, 0); });
      const layout = await page.evaluate(() => {
        const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const breaks = s => { const e = document.querySelector(s), t = e.firstChild; const ys = [0, t.textContent.indexOf('\n') + 1].map(i => { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect().top; }); return ys[1] > ys[0] + 20; };
        return { card: rect('#reciteCard'), answer: rect('#answerText'), title: rect('.brand strong'), status: rect('.card-meta'), prompt: rect('#promptText'), breaks: breaks('#promptText') && breaks('#answerText'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.breaks, true, 'authored breaks occupy separate rendered lines in Chinese and English');
      assert.equal(layout.overflow, false);
      if (viewport.width > viewport.height) {
        assert.ok(layout.card.top <= 10, 'landscape card starts at the very top');
        assert.ok(layout.title.right <= layout.card.left, 'title belongs in the left rail');
        assert.ok(layout.status.top - layout.card.top <= 6, 'meta row sits near the card top');
        assert.ok(layout.prompt.top - layout.status.bottom <= 6, 'Chinese follows the meta row closely');
        assert.ok(layout.answer.bottom < viewport.height, 'complete multiline answer is visible without scrolling');
        assert.equal(await page.locator('.brand-mark').isVisible(), false);
        assert.equal(await page.locator('.brand small').isVisible(), false);
        assert.equal(await page.locator('#studyAssignmentTitle').isVisible(), false);
        assert.equal(await page.locator('#desktopSettingsButton').isVisible(), true);
      } else {
        assert.equal(await page.locator('#studyAssignmentTitle').isVisible(), true);
      }
      await page.screenshot({ path: resolve(shots, `multiline-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    }
    await page.locator('#previousItemButton').click();
    assert.equal(await page.locator('#answerText').textContent(), 'Name', 'search navigation retains original notebook order');
    await page.locator('#nextItemButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '2 / 3');
    await page.reload();
    await page.locator('#startStudyButton').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 3', 'new sessions still start in imported order');
    await page.locator('#nextItemButton').click();
    assert.match(await page.locator('#answerText').textContent(), /together\.\nWe/);
    await page.locator('#searchButton').click();
    await page.locator('#searchInput').fill('name');
    await page.locator('[data-search-assignment="b"]').click();
    assert.equal(await page.locator('#studyCounter').textContent(), '1 / 1');
    await page.locator('.mobile-nav [data-view-target="home"]').click();
    assert.equal(await page.locator('#activeAssignmentTitle').textContent(), '另一份作业', 'home reflects the notebook opened from search');
  } finally { await context.close(); }
}
