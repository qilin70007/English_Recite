import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openZip } from "../archive.js";

export async function runStudyChecks(browser, baseURL, shots, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.ttsCalls = [];
    window.media = [];
    const OriginalAudio = window.Audio;
    window.Audio = class extends OriginalAudio {
      constructor(src) { super(src); this.playCalls = []; this.pauseCalls = 0; window.media.push(this); }
      play() { this.playCalls.push(this.currentTime); return super.play(); }
      pause() { this.pauseCalls++; return super.pause(); }
    };
    window.AndroidTts = {
      getStatus: () => "ready:test", getVoices: () => "[]", speakLocalized() {}, stop() {},
      speakWithVoice(text, lang, rate, repeat, id) {
        window.ttsCalls.push({ text, lang });
        setTimeout(() => window.dispatchEvent(new CustomEvent("native-tts-done", { detail: { id } })), 20);
      },
    };
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.evaluate(async () => {
      const { saveAudio } = await import("./audio-store.js");
      const file = new File([await (await fetch("./tests/fixtures/continuous.mp3")).blob()], "连续听读.mp3", { type: "audio/mpeg" });
      const audio = await saveAudio("assignment:a", file);
      localStorage.setItem("englishRecite.state.v1", JSON.stringify({
        version: 2, activeAssignmentId: "a", settings: { autoSpeak: true, repeat: 1, rate: 1 },
        assignments: [
          { id: "a", title: "9月10日 · 连续听读", audio, items: [
            { id: "a1", prompt: "名称", answer: "name", status: "unknown" },
            { id: "a2", prompt: "我对科学感兴趣。", answer: "I am interested in science.", status: "fuzzy" },
            { id: "a3", prompt: "为上课做好准备", answer: "get ready for class", status: "new" },
            { id: "a4", prompt: "一起学习", answer: "learn together", status: "mastered" },
          ] },
          { id: "b", title: "这次不导出的作业本", items: [{ id: "b1", prompt: "跳过", answer: "exclude this notebook", status: "unknown" }] },
          { id: "c", title: "9月12日 · 课文与长标题的换行检查", type: "text", items: [{ id: "c1", answer: "We can help each other.", status: "fuzzy" }] },
        ],
      }));
    });
    await page.reload();
    assert.equal(await page.locator('#homeView [data-action="import"], .mobile-add, .sidebar [data-action="import"]').count(), 0);
    assert.equal(await page.locator('.mobile-nav button').count(), 3);
    for (const width of [360, 390, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const offsets = await page.locator('.stat-icon, [data-action=settings]:visible [data-icon]').evaluateAll((nodes) => nodes.map((element) => {
        const box = element.getBoundingClientRect(), glyph = element.querySelector("svg").getBoundingClientRect();
        return { x: Math.abs(box.x + box.width / 2 - glyph.x - glyph.width / 2), y: Math.abs(box.y + box.height / 2 - glyph.y - glyph.height / 2) };
      }));
      assert.ok(offsets.every(({ x, y }) => x <= 0.6 && y <= 0.6), `icons centered at ${width}px: ${JSON.stringify(offsets)}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(shots, `home-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#startStudyButton").click();
    // Check the actual viewing area, including a short 320px Android screen.
    for (const viewport of [{ width: 320, height: 640 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 720, height: 900 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { document.getAnimations().forEach((animation) => animation.finish()); window.scrollTo(0, 0); });
      const layout = await page.evaluate(() => {
        const box = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 };
        };
        return {
          title: box(".brand strong"), topbar: box(".topbar"), card: box("#reciteCard"),
          overview: box("#overviewStudyButton"), counter: box("#studyCounter"), toggle: box(".answer-visibility-toggle"),
          status: box("#currentStatusPill"), edit: box("#editItemButton"), speak: box("#speakButton"), preferences: box(".study-preferences"),
          next: box("#nextItemButton"), filters: box(".study-filter-bar"), nav: box(".mobile-nav"),
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      assert.ok(Math.abs(layout.title.centerX - viewport.width / 2) <= 0.6, "app title is centered on the screen");
      assert.ok(layout.card.top >= layout.topbar.bottom && layout.card.top <= 160, `card starts in the main viewing area at ${viewport.width}px`);
      assert.ok(layout.counter.top >= layout.card.top && Math.abs(layout.counter.centerX - layout.card.centerX) <= 0.6, "number progress is centered within the card");
      assert.ok(Math.abs(layout.counter.centerY - layout.status.centerY) <= 1 && Math.abs(layout.counter.centerY - layout.edit.centerY) <= 1, "status, progress and edit share the card's top row");
      assert.ok(layout.preferences.top >= layout.next.bottom + 16 && layout.filters.top - layout.preferences.bottom >= 0 && layout.filters.top - layout.preferences.bottom <= 12, "overview and reading controls sit immediately above scope filters, after navigation");
      assert.ok(layout.toggle.left >= layout.overview.right + 4 && layout.toggle.left - layout.overview.right <= 16 && Math.abs(layout.toggle.centerY - layout.overview.centerY) <= 1, "English switch sits beside overview instead of the far right");
      assert.ok(layout.speak.left >= layout.toggle.right + 4 && Math.abs(layout.speak.centerY - layout.toggle.centerY) <= 1, "read button sits to the right of the English switch");
      assert.ok(layout.noHorizontalOverflow, `no horizontal overflow at ${viewport.width}px`);
      if (viewport.width <= 720) {
        assert.ok(layout.next.bottom <= layout.nav.top, `word and navigation fit above the bottom bar at ${viewport.width}×${viewport.height}: ${JSON.stringify(layout)}`);
        assert.ok(await page.locator("#settingsButton").evaluate((button) => button.getBoundingClientRect().bottom <= innerHeight && button.getBoundingClientRect().top >= innerHeight - 80), "settings is in bottom navigation");
      }
      await page.screenshot({ path: resolve(shots, `study-focus-${viewport.width}.png`), animations: "disabled" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#settingsButton").click();
    await page.locator('[data-close-dialog=settingsDialog]').click();
    assert.equal(await page.locator("#studyCounter").textContent(), "1 / 4", "bottom settings preserves the current card");
    assert.equal(await page.locator("#alwaysShowAnswerInput").isChecked(), false, "default hides each new answer");
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#promptLabel, #speakPromptButton, #thinkHint, .self-check > p").count(), 0);
    assert.equal(await page.locator("#reciteCard #speakButton").count(), 0, "read button has moved out of the card");
    await page.locator("#answerPanel").click();
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "true");
    await page.locator("#nextItemButton").click();
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "false");
    await page.locator("#previousItemButton").click();
    await page.locator("#alwaysShowAnswerInput").check();
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "true");

    // Real MP3 decoding/timeline in Chromium, while the app uses the Android TTS bridge mock.
    await page.evaluate(() => { window.ttsCalls = []; });
    await page.locator("#continuousPlayButton").click();
    await page.waitForFunction(() => window.media[0]?.currentTime > 0.3 && document.querySelector("#continuousPlayButton").dataset.audioState === "playing");
    const beforeNext = await page.evaluate(() => window.media[0].currentTime);
    await page.locator("#overviewStudyButton").click();
    assert.equal(await page.locator(".whole-entry").count(), 4);
    await page.waitForFunction((position) => window.media[0].currentTime > position + 0.1, beforeNext);
    await page.locator("#wholeStudyButton").click();
    assert.equal(await page.locator("#studyCounter").textContent(), "1 / 4");
    assert.equal(await page.evaluate(() => window.media[0].pauseCalls), 0, "reading the full text must keep the notebook MP3 playing");
    await page.locator("#nextItemButton").click();
    await page.locator("#previousItemButton").click();
    await page.locator("#answerPanel").click();
    await page.locator('[data-status="mastered"]').click();
    await page.waitForFunction(() => document.querySelector("#studyCounter").textContent === "2 / 4");
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "true");
    assert.ok(await page.evaluate((before) => window.media.length === 1 && !window.media[0].paused && window.media[0].currentTime > before && window.media[0].pauseCalls === 0 && window.media[0].playCalls.length === 1, beforeNext), "card navigation and marking keep the same MP3 playing");
    assert.equal(await page.evaluate(() => window.ttsCalls.length), 0, "auto TTS cannot interrupt whole MP3");
    await page.locator("#alwaysShowAnswerInput").uncheck();
    await page.locator("#answerPanel").click();
    await page.locator("#nextItemButton").click();
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "false");
    assert.equal(await page.evaluate(() => window.media[0].paused), false);
    await page.locator("#continuousPlayButton").click();
    await page.waitForFunction(() => window.media[0].paused);
    const pausedAt = await page.evaluate(() => window.media[0].currentTime);
    assert.match(await page.locator("#continuousPlayButton").textContent(), /继续播放/);
    await page.locator("#previousItemButton").click();
    await page.locator("#nextItemButton").click();
    assert.equal(await page.evaluate(() => window.media[0].currentTime), pausedAt);
    await page.locator("#continuousPlayButton").click();
    await page.waitForFunction((position) => window.media[0].currentTime > position + 0.2, pausedAt);
    assert.ok(await page.evaluate((position) => Math.abs(window.media[0].playCalls.at(-1) - position) < 0.02, pausedAt), "resume starts at the paused time");
    assert.equal(await page.evaluate(() => window.media.length), 1);
    await page.locator("#continuousPlayButton").click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: resolve(shots, "study-hidden-mobile.png"), animations: "disabled" });
    await page.locator("#alwaysShowAnswerInput").check();
    await page.screenshot({ path: resolve(shots, "study-visible-mobile.png"), animations: "disabled" });
    await page.reload();
    await page.locator("#startStudyButton").click();
    assert.equal(await page.locator("#alwaysShowAnswerInput").isChecked(), true, "answer preference survives reload");
    await page.locator("#nextItemButton").click();
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "true");
    await page.locator("#alwaysShowAnswerInput").uncheck();
    await page.locator("#studyScopeSelect").selectOption("c");
    await page.locator("#applyStudyFilterButton").click();
    assert.equal(await page.locator("#answerPanel").getAttribute("aria-expanded"), "false", "text-only notebooks respect the switch too");

    await page.locator(".mobile-nav [data-view-target=library]").click();
    assert.equal(await page.locator(".library-card details").count(), 0);
    for (const width of [360, 390, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const first = page.locator(".library-card").first();
      for (const action of ["start", "focus", "edit", "word", "move-up", "move-down", "export", "delete"]) {
        assert.equal(await first.locator(`[data-assignment-action="${action}"]`).isVisible(), true);
      }
      assert.ok(await first.locator("button").evaluateAll((buttons) => buttons.every((button) => button.scrollWidth <= button.clientWidth + 1)), `button labels fit at ${width}px`);
      await page.screenshot({ path: resolve(shots, `notebooks-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-assignment-action=word]').first().click();
    assert.deepEqual(await page.locator('[name=wordNotebook]:checked').evaluateAll((inputs) => inputs.map((input) => input.value)), ["a"]);
    await page.locator('[name=wordNotebook][value=c]').check();
    assert.match(await page.locator("#wordExportSummary").textContent(), /2 本作业中的 2 条/);
    await page.screenshot({ path: resolve(shots, "word-multi-mobile.png"), fullPage: true, animations: "disabled" });
    const downloaded = page.waitForEvent("download");
    await page.locator("#saveWordButton").click();
    const file = await downloaded;
    const zip = await openZip(new Blob([await readFile(await file.path())]));
    const xml = await (await zip.get("word/document.xml").read()).text();
    assert.match(xml, /9月10日 · 连续听读/);
    assert.match(xml, /9月12日 · 课文与长标题的换行检查/);
    assert.doesNotMatch(xml, /这次不导出的作业本|exclude this notebook/);
    await page.locator("#exportWordButton").click();
    assert.equal(await page.locator('[name=wordNotebook]:checked').count(), 3);
    await page.locator('[data-word-select=none]').click();
    assert.equal(await page.locator("#saveWordButton").isDisabled(), true);
    await page.locator('[data-word-select=all]').click();
    assert.equal(await page.locator('[name=wordNotebook]:checked').count(), 3);
    await page.locator('[data-close-dialog=wordExportDialog]').first().click();
  } finally { await context.close(); }
}
