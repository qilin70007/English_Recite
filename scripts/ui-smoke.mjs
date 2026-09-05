import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + "/")) throw new Error("invalid path");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("englishRecite.state.v1")));
const shots = resolve(root, "output/ui");
await mkdir(shots, { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    window.ttsCalls = [];
    window.mp3Calls = [];
    window.AndroidTts = {
      getStatus: () => "ready:test.engine",
      getVoices: (lang) => JSON.stringify(lang === "zh-CN" ? [
        { id: "test.engine|cn1", name: "Mandarin A", lang: "zh-CN", local: true, quality: 500 },
        { id: "test.engine|cn2", name: "Mandarin B", lang: "zh-CN", local: true, quality: 400 },
        { id: "test.engine|hk", name: "Cantonese", lang: "zh-HK", local: true, quality: 500 },
      ] : [{ id: "test.engine|en", name: "English", lang: "en-US", local: true, quality: 400 }]),
      speakLocalized() {},
      speakWithVoice(text, lang, rate, repeat, id, voiceId) {
        window.ttsCalls.push({ text, lang, rate, repeat, id, voiceId });
        setTimeout(() => window.dispatchEvent(new CustomEvent("native-tts-done", { detail: { id } })), 30);
      },
      stop() {}, openSettings() {},
    };
    // This checks MP3 selection/dispatch; acoustic output is tested on a phone.
    window.Audio = class {
      constructor(src) { this.src = src; }
      play() { window.mp3Calls.push(this.src); setTimeout(() => this.onended?.(), 30); return Promise.resolve(); }
      pause() {} load() {} removeAttribute() {}
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.locator("#loadDemoButton").click();
  await page.locator(".mobile-nav [data-view-target=library]").click();
  for (const width of [360, 390, 720]) {
    await page.setViewportSize({ width, height: 844 });
    const button = await page.locator(".library-add-button").evaluate((element) => ({
      text: element.textContent, font: parseFloat(getComputedStyle(element).fontSize),
      color: getComputedStyle(element).color, right: element.getBoundingClientRect().right,
      width: element.getBoundingClientRect().width,
    }));
    assert.match(button.text, /新建/);
    assert.ok(button.font >= 14 && button.width >= 78 && button.right <= width);
    assert.equal(button.color, "rgb(255, 255, 255)");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(shots, "notebooks-mobile.png"), fullPage: true });
  await page.locator(".library-add-button").click();
  await page.locator("#assignmentTitleInput").fill("格式与声音验证");
  await page.locator("#insertExampleButton").click();
  await page.locator("#saveAssignmentButton").click();
  assert.equal((await state(page)).assignments.length, 1, "first submit must only preview");
  assert.equal(await page.locator("#importPreview").isVisible(), true);
  await page.locator('[data-preview-index="0"] [data-preview-field=prompt]').fill("名称（名字）");
  await page.locator('[data-preview-index="0"] [data-preview-field=answer]').fill("");
  await page.locator("#saveAssignmentButton").click();
  assert.match(await page.locator("#importError").textContent(), /缺少英文/);
  assert.equal((await state(page)).assignments.length, 1);
  await page.locator('[data-preview-index="0"] [data-preview-field=answer]').fill("name");
  await page.screenshot({ path: resolve(shots, "import-preview-mobile.png"), fullPage: true });
  await page.locator("#saveAssignmentButton").click();
  assert.equal((await state(page)).assignments.length, 2);
  assert.deepEqual((await state(page)).assignments[0].items.slice(0, 1).map(({ prompt, answer }) => ({ prompt, answer })), [{ prompt: "名称（名字）", answer: "name" }]);
  await page.locator("#speakPromptButton").click();
  await page.waitForFunction(() => window.ttsCalls.length >= 1);
  assert.deepEqual(await page.evaluate(() => window.ttsCalls.map(({ text, lang, rate }) => ({ text, lang, rate }))), [{ text: "名称（名字）", lang: "zh-CN", rate: 1 }]);
  await page.locator("#editItemButton").click();
  await page.locator("#editAudioInput").setInputFiles({ name: "name.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3-audio-dispatch-fixture") });
  await page.locator('#editItemForm [type=submit]').click();
  await page.evaluate(() => { window.ttsCalls = []; });
  await page.locator("#speakButton").click();
  await page.waitForFunction(() => window.mp3Calls.length > 0);
  assert.equal(await page.evaluate(() => window.ttsCalls.length), 0, "item MP3 must take precedence");
  await page.locator('#speakButton').click(); // stop MP3 or start again; marking below cancels it
  await page.locator('[data-status=unknown]').dispatchEvent("click");
  await page.locator('[data-status=unknown]').dispatchEvent("click");
  await page.waitForFunction(() => document.querySelector("#studyCounter").textContent === "2 / 3");
  assert.equal((await state(page)).assignments[0].items[0].reviewCount, 1, "double tap must not skip a card");
  await page.locator("#studyScopeSelect").selectOption("all");
  await page.locator("#studyStatusFilter").selectOption("focus");
  await page.locator("#applyStudyFilterButton").click();
  assert.equal(await page.locator("#studyCounter").textContent(), "1 / 1");
  await page.locator("#settingsButton").click();
  assert.equal(await page.locator('#chineseVoiceSelect option[value="test.engine|hk"]').count(), 0);
  await page.locator("#chineseVoiceSelect").selectOption("test.engine|cn2");
  await page.locator("#rateSelect").selectOption("0.7");
  await page.evaluate(() => { window.ttsCalls = []; });
  await page.locator("#testSpeechButton").click();
  await page.waitForFunction(() => window.ttsCalls.length === 2);
  const calls = await page.evaluate(() => window.ttsCalls);
  assert.equal(calls[0].text, "名称。名词。今天我们一起学习英语。");
  assert.equal(calls[0].lang, "zh-CN");
  assert.equal(calls[0].rate, 1);
  assert.equal(calls[0].voiceId, "test.engine|cn2");
  assert.equal(calls[1].lang, "en-US");
  assert.equal(calls[1].rate, 0.7);
  await page.screenshot({ path: resolve(shots, "speech-settings-mobile.png"), fullPage: true });
  await page.locator('#settingsForm [type=submit]').click();
  await page.reload();
  await page.locator("#settingsButton").click();
  assert.equal(await page.locator("#chineseVoiceSelect").inputValue(), "test.engine|cn2");
  await page.locator('[data-close-dialog=settingsDialog]').click();
  await page.locator(".mobile-nav [data-view-target=library]").click();
  await page.locator('.library-card').first().locator(".assignment-more summary").click();
  assert.equal(await page.locator('.library-card').first().locator('[data-assignment-action=move-down]').isVisible(), true);
  await page.locator('.library-card').first().locator('[data-assignment-action=move-down]').click();
  assert.equal((await state(page)).assignments[1].title, "格式与声音验证");
  await page.locator('[data-assignment-action=edit]').last().click();
  await page.locator("#editAssignmentTitleInput").fill("已校对作业");
  await page.locator("#saveAssignmentEditButton").click();
  assert.equal((await state(page)).assignments[1].title, "已校对作业");
  await context.close();

  // Browser fallback must also select Mandarin and use each segment's language/rate.
  const webContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await webContext.addInitScript(() => {
    window.ttsCalls = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [
        { voiceURI: "hk", name: "Cantonese", lang: "zh-HK", localService: true },
        { voiceURI: "cn", name: "普通话", lang: "zh-CN", localService: true },
        { voiceURI: "en", name: "English", lang: "en-US", localService: true },
      ],
      speak: (utterance) => { window.ttsCalls.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate, voice: utterance.voice?.voiceURI }); setTimeout(() => utterance.onend?.(), 20); },
      cancel() {}, addEventListener() {},
    } });
  });
  const webPage = await webContext.newPage();
  webPage.on("pageerror", (error) => errors.push(error.message));
  await webPage.goto(baseURL);
  await webPage.locator("#settingsButton").click();
  await webPage.locator("#testSpeechButton").click();
  await webPage.waitForFunction(() => window.ttsCalls.length === 2);
  assert.deepEqual(await webPage.evaluate(() => window.ttsCalls.map(({ lang, rate, voice }) => ({ lang, rate, voice }))), [
    { lang: "zh-CN", rate: 1, voice: "cn" }, { lang: "en-US", rate: 0.85, voice: "en" },
  ]);
  assert.deepEqual(errors, [], "no browser exceptions");
  console.log("UI smoke passed: 360/390/720px buttons, labeled preview/edit/validation, MP3 priority, status double tap, filters, native/browser speech dispatch, saved voices, ordering and rename.");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
