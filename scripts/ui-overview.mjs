import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function runOverviewChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    const longText = Array.from({ length: 16 }, (_, index) => `Paragraph ${index + 1}. We can help each other.\nOn the way to school, we read English together.\nWe learn something new every day.`).join("\n\n") + "\nThe complete ending.";
    await page.evaluate((longText) => {
      localStorage.setItem("englishRecite.state.v1", JSON.stringify({
        version: 2, activeAssignmentId: "daily", settings: { autoSpeak: false }, assignments: [
          { id: "daily", title: "9月13日 · 按导入顺序背诵", items: [
            { id: "first", prompt: "第一条 · 已经掌握", answer: "first", note: "名词；保留 <标签> & 备注", status: "mastered", lastReviewed: "2026-09-12" },
            { id: "second", prompt: "第二条 · 有点模糊", answer: "second", status: "fuzzy", lastReviewed: "2026-09-11" },
            { id: "third", prompt: "第三条 · 还没标记", answer: "third", status: "new" },
            { id: "fourth", prompt: "第四条 · 不认识", answer: "fourth", status: "unknown", lastReviewed: "2026-09-10" },
          ] },
          { id: "reading", title: "9月14日 · 完整课文与分段阅读", type: "text", items: [
            { id: "paragraph", answer: longText, prompt: "完整中文提示。\n这里保留换行。", note: "不能截断最后一段。", status: "mastered" },
            { id: "ending", prompt: "最后一条", answer: "This is the final entry.", status: "new" },
          ] },
        ],
      }));
    }, longText);
    await page.reload();
    const snapshot = await page.evaluate(() => localStorage.getItem("englishRecite.state.v1"));
    await page.locator("#overviewHomeButton").click();
    assert.equal(await page.locator("#wholeAssignmentTitle").textContent(), "9月13日 · 按导入顺序背诵");
    assert.deepEqual(await page.locator(".whole-entry").evaluateAll((nodes) => nodes.map((node) => node.dataset.wholeItemId)), ["first", "second", "third", "fourth"]);
    assert.equal(await page.locator(".whole-note").textContent(), "名词；保留 <标签> & 备注");
    assert.equal(await page.locator(".whole-chinese").first().textContent(), "第一条 · 已经掌握");
    assert.equal(await page.locator(".whole-english").first().isVisible(), true, "overview always shows mastered and concealed answers");
    assert.equal(await page.evaluate(() => localStorage.getItem("englishRecite.state.v1")), snapshot, "reading cannot change progress, order or preferences");
    await page.screenshot({ path: resolve(shots, "whole-words-mobile.png"), animations: "disabled" });
    await page.locator("#wholeStudyButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "first", "start must not put unknown words first");
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "false");
    await page.locator("#nextItemButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "second");
    await page.locator("#overviewStudyButton").click();
    assert.equal(await page.locator("#wholeStudyButton").textContent(), "返回背诵");
    await page.locator("#wholeStudyButton").click();
    assert.equal(await page.locator("#studyCounter").textContent(), "2 / 4");
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "false");
    await page.locator("#nextItemButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "third");
    await page.locator("#nextItemButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "fourth");
    await page.locator(".mobile-nav [data-view-target=home]").click();
    await page.locator("#startStudyButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "first");

    // A filtered session can consult the complete notebook and return without resetting it.
    await page.locator("#studyStatusFilter").selectOption("unknown");
    await page.locator("#applyStudyFilterButton").click();
    assert.equal(await page.locator("#studyCounter").textContent(), "1 / 1");
    assert.equal(await page.locator("#answerText").textContent(), "fourth");
    await page.locator("#overviewStudyButton").click();
    assert.equal(await page.locator(".whole-entry").count(), 4);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#wholeAssignmentDialog").isVisible(), false);
    assert.equal(await page.locator("#studyCounter").textContent(), "1 / 1");
    assert.equal(await page.locator("#studyStatusFilter").inputValue(), "unknown");

    await page.locator(".mobile-nav [data-view-target=library]").click();
    await page.locator('[data-assignment-action=overview][data-assignment-id=reading]').click();
    assert.equal(await page.locator(".whole-entry").count(), 2);
    assert.equal(await page.locator(".whole-english").first().textContent(), longText);
    assert.equal(await page.locator(".whole-chinese").first().textContent(), "完整中文提示。\n这里保留换行。");
    for (const width of [360, 390, 720, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator("#wholeAssignmentBody").evaluate((element) => { element.scrollTop = 0; });
      const dimensions = await page.locator("#wholeAssignmentBody").evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
      assert.ok(dimensions.width >= Math.min(320, width - 36));
      assert.ok(dimensions.scrollWidth <= dimensions.width, `long text wraps at ${width}px`);
      assert.ok(dimensions.scrollHeight > dimensions.height, "full text scrolls instead of being truncated");
      assert.equal(await page.locator(".whole-english").first().evaluate((element) => getComputedStyle(element).whiteSpace), "pre-wrap");
      await page.screenshot({ path: resolve(shots, `whole-reading-${width}.png`), animations: "disabled" });
      await page.locator(".whole-entry").last().scrollIntoViewIfNeeded();
      assert.equal(await page.locator(".whole-english").last().textContent(), "This is the final entry.");
      assert.ok(await page.locator("#wholeStudyButton").evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight), "actions remain on-screen after scrolling");
      assert.ok(await page.locator('[data-close-dialog=wholeAssignmentDialog]').evaluate((element) => element.getBoundingClientRect().top >= 0), "close remains on-screen after scrolling");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".whole-entry").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(shots, "whole-reading-end-mobile.png"), animations: "disabled" });
    await page.locator("#wholeStudyButton").click();
    assert.equal(await page.locator("#studyScopeSelect").inputValue(), "reading", "start from overview selects that notebook");
    assert.equal(await page.locator("#answerText").textContent(), longText);

    // Explicit manual reordering remains authoritative in both views and after reload.
    await page.locator(".mobile-nav [data-view-target=library]").click();
    await page.locator('[data-assignment-action=edit][data-assignment-id=daily]').click();
    await page.locator('.bulk-edit-row').first().locator('[data-bulk-action=down]').click();
    await page.locator("#saveAssignmentEditButton").click();
    await page.waitForFunction(() => !document.querySelector("#editAssignmentDialog").open);
    await page.locator('[data-assignment-action=overview][data-assignment-id=daily]').click();
    assert.deepEqual(await page.locator(".whole-entry").evaluateAll((nodes) => nodes.map((node) => node.dataset.wholeItemId)), ["second", "first", "third", "fourth"]);
    await page.locator("#wholeStudyButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "second");
    await page.locator('[data-status=mastered]').click();
    await page.waitForFunction(() => document.querySelector("#studyCounter").textContent === "2 / 4");
    await page.reload();
    await page.locator("#startStudyButton").click();
    assert.equal(await page.locator("#answerText").textContent(), "second", "changing status cannot reorder the next session");
  } finally { await context.close(); }
}
