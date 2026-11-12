/** Real application smoke coverage for the iOS material UI. No live account or media is used.
 * Run: BROWSER_EXECUTABLE=/opt/google/chrome/chrome node scripts/test-ios-ui.mjs
 * Screenshots and a machine-readable report are written below test-results/ios-ui/.
 */
import assert from "node:assert/strict";
import { installFixture } from "./fixtures/app-ui.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL(`../test-results/ios-ui/${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url);
await mkdir(output, { recursive: true });
const report = {
  environment: "Real App in Chromium; mocked Tauri IPC and poster images. Android back event exercises the real App listener; native WebViews and media playback are not covered.",
  cases: [], errors: [], external: [],
};
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1";
const android = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const cases = [
  { width: 1440, height: 960, mobile: false, theme: "dark" },
  { width: 900, height: 740, mobile: false, theme: "light" },
  { width: 390, height: 844, mobile: true, theme: "dark" },
  { width: 320, height: 694, mobile: true, theme: "light", reduced: true },
  { width: 844, height: 390, mobile: true, theme: "dark", reduced: true },
  { width: 390, height: 844, mobile: true, theme: "light", android: true },
  { width: 375, height: 812, mobile: true, theme: "light" },
  { width: 375, height: 812, mobile: true, theme: "dark", minimumFontSize: 20 },
];
const caseName = test => `${test.width}x${test.height}-${test.theme}${test.android ? "-android" : ""}${test.minimumFontSize ? `-font${test.minimumFontSize}` : ""}`;
const selectedCases = process.env.IOS_UI_CASE ? cases.filter(test => caseName(test) === process.env.IOS_UI_CASE) : cases;
assert(selectedCases.length, "IOS_UI_CASE must match one of the defined scenarios");
const titles = ["城市与晚风", "重逢在夏日以后", "星河旅人", "无声的答案", "我的奇妙假期", "晴天来信"];
const titlePattern = new RegExp(`^(${titles.join("|")})$`);
let vite, browser;

// Passed directly to addInitScript so every reload starts with isolated fixture data.

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  const browserOptions = { headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined };
  browser = await chromium.launch(browserOptions);
  for (const test of selectedCases) {
    const name = caseName(test);
    const result = { ...test, name, checks: [], screenshots: [], passed: false };
    report.cases.push(result);
    const caseBrowser = test.minimumFontSize ? await chromium.launch({ ...browserOptions,
      args: [`--blink-settings=minimumFontSize=${test.minimumFontSize},minimumLogicalFontSize=${test.minimumFontSize}`],
    }) : browser;
    const context = await caseBrowser.newContext({
      viewport: { width: test.width, height: test.height }, colorScheme: test.theme,
      reducedMotion: test.reduced ? "reduce" : "no-preference",
      ...(test.mobile ? { userAgent: test.android ? android : iphone, isMobile: true, hasTouch: true } : {}),
    });
    await context.addInitScript(installFixture, { theme: test.theme, titles });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => report.errors.push({ case: name, message: error.message }));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(origin).origin) return route.continue();
      if (url.pathname === "/img") return route.fulfill({
        contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#5b7e94"/><stop offset="1" stop-color="#172e42"/></linearGradient></defs><rect width="360" height="480" fill="url(#g)"/><circle cx="180" cy="150" r="60" fill="#8ca8b5"/><path d="M45 480Q180 100 315 480" fill="#263f50"/></svg>',
      });
      report.external.push({ case: name, url: url.href });
      return route.abort();
    });
    const check = label => result.checks.push(label);
    const shot = async label => {
      // Playwright finishes finite CSS transitions; infinite loaders cannot stall the run.
      const filename = `${name}-${label}.png`;
      await page.screenshot({ path: fileURLToPath(new URL(filename, output)), animations: "disabled" });
      result.screenshots.push(filename);
      const layout = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth <= innerWidth + 1,
        grids: [...document.querySelectorAll(".ios-media-grid")]
          .filter(el => !el.closest("[inert], [aria-hidden=true]") && el.getClientRects().length)
          .every(el => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 1),
      }));
      assert(layout.document && layout.grids, `${label}: no horizontal page or media-grid overflow`);
    };
    const returnFromOverlay = async () => {
      if (test.android) await page.evaluate(() => window.__IOS_UI_FIXTURE__.hardwareBack());
      else assert.equal(await page.evaluate(async () => (await import("/src/back.ts")).runBack()), true, "Overlay consumes the shared back handler");
    };
    try {
      await page.goto(origin);
      if (test.minimumFontSize) assert(await page.evaluate(minimum => {
        const probe = document.createElement("span"); probe.style.fontSize = "12px"; probe.textContent = "字号";
        document.body.append(probe); const size = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
        return size >= minimum;
      }, test.minimumFontSize), "Chromium applies the enlarged minimum text size");
      const nav = page.getByRole("navigation", { name: "主导航" });
      for (const label of ["首页", "搜索", "分类", "我的"]) await nav.getByRole("button", { name: label, exact: true }).waitFor();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, test.theme);
      if (test.android) await page.waitForFunction(() => window.__IOS_UI_FIXTURE__.hasHardwareBack());
      check("original navigation and persisted appearance");

      await nav.getByRole("button", { name: "搜索", exact: true }).click();
      const query = page.getByRole("textbox", { name: "搜索短剧、帖子、题材…" });
      await query.fill("都市"); await query.press("Enter");
      await page.getByRole("button", { name: titles[0], exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: titlePattern }).count(), titles.length);
      await shot("search"); check("search results and responsive poster grid");

      await nav.getByRole("button", { name: "分类", exact: true }).click();
      await page.getByRole("button").filter({ has: page.getByText("专题", { exact: true }) }).click();
      const topic = page.getByRole("button").filter({ has: page.getByText("本周精选", { exact: true }) });
      await topic.click();
      await page.getByRole("button", { name: titles[0], exact: true }).waitFor();
      assert.equal(await topic.count(), 0, "Covered topic-list controls are removed from the accessibility tree");
      assert.equal(await page.getByRole("button", { name: "返回", exact: true }).count(), 1, "Only the top page's back control is accessible");
      await shot("topic");
      await page.keyboard.press("Escape");
      await topic.waitFor(); // Wait for React to commit before a second Escape.
      await page.keyboard.press("Escape");
      await page.getByRole("button").filter({ has: page.getByText("专题", { exact: true }) }).waitFor();
      check("topic navigation, inert background, and sequential Escape");

      await nav.getByRole("button", { name: "我的", exact: true }).click();
      await page.getByRole("button", { name: titles[0], exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: titlePattern }).count(), titles.length);
      result.posterWidth = Math.round(await page.getByRole("button", { name: titles[0], exact: true }).evaluate(el => el.getBoundingClientRect().width));
      await shot("favorites");
      await page.getByRole("button", { name: "观看历史", exact: true }).click();
      await page.getByText("第 3 集 · 0:55", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: titlePattern }).count(), 1);
      check("local favorites and preserved playback progress");

      const login = page.getByRole("button").filter({ has: page.getByText("未登录", { exact: true }) });
      await login.click();
      const dialog = page.getByRole("dialog", { name: "登录 HGhubX", exact: true });
      await dialog.waitFor();
      const username = dialog.getByLabel("账号", { exact: true });
      const password = dialog.getByLabel("密码", { exact: true });
      await username.fill("sample"); await password.fill("test-password");
      await dialog.getByRole("button", { name: "登录", exact: true }).last().click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.getByRole("alert").textContent(), "账号或密码不正确");
      assert.equal(await username.inputValue(), "sample", "An unsuccessful login preserves the account input");
      assert.equal(await page.getByRole("button", { name: "观看历史", exact: true }).count(), 0, "The login dialog makes its background inert");
      await dialog.evaluate(el => {
        const items = [...el.querySelectorAll("button:not(:disabled), input:not(:disabled)")].filter(item => item.tabIndex >= 0 && item.getClientRects().length);
        items.at(-1).focus();
      });
      await page.keyboard.press("Tab");
      assert(await dialog.evaluate(el => el.contains(document.activeElement)), "Forward Tab stays in the dialog");
      await page.keyboard.press("Shift+Tab");
      assert(await dialog.evaluate(el => el.contains(document.activeElement)), "Backward Tab stays in the dialog");
      await shot("login");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(el => el === document.activeElement, await login.elementHandle());
      await login.click(); await dialog.waitFor();
      await returnFromOverlay(); await dialog.waitFor({ state: "hidden" });
      await login.waitFor();
      check("visible form labels, login errors, focus trap, Escape, and overlay back");

      await page.getByRole("button", { name: "设置", exact: true }).click();
      const security = page.getByRole("switch", { name: "严格安全模式", exact: true });
      await security.waitFor();
      const pageIn = page.locator(".a-page-in");
      if (await pageIn.count()) {
        await pageIn.first().evaluate(async el => {
          await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined)));
        });
      }
      const switches = page.getByRole("switch");
      result.switches = [];
      for (const item of await switches.all()) {
        const bounds = await item.boundingBox();
        const target = await item.evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
        const visual = await item.evaluate(el => {
          const track = getComputedStyle(el.querySelector(".ios-switch-track"));
          const thumb = getComputedStyle(el.querySelector(".ios-switch-thumb"));
          return { trackWidth: track.width, trackBorder: track.borderTopWidth, trackBackground: track.backgroundImage,
            thumbBackground: thumb.backgroundImage };
        });
        result.switches.push({ label: await item.getAttribute("aria-label"), width: target.width, height: target.height, visualBounds: bounds, ...visual });
        assert(target.width >= 44 && target.height >= (test.android ? 48 : 44), "Switch touch target meets the platform minimum");
        assert(["true", "false"].includes(await item.getAttribute("aria-checked")), "Switch exposes its state");
        if (test.android) {
          assert.equal(visual.trackWidth, "54px", "Android renders the wider glass switch track");
          assert.notEqual(visual.trackBorder, "0px", "Android switch track has a visible glass edge");
          assert.match(visual.thumbBackground, /linear-gradient/, "Android thumb uses the metallic finish");
        }
      }
      await security.click();
      await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="严格安全模式"]')?.getAttribute("aria-checked") === "false");
      const appearance = page.getByRole("switch", { name: "深色外观", exact: true });
      await appearance.click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme !== theme, test.theme);
      await appearance.click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, test.theme);
      await appearance.scrollIntoViewIfNeeded();
      await shot("settings");
      const clearCache = page.getByRole("button").filter({ has: page.getByText("清理缓存", { exact: true }) });
      await clearCache.click();
      const confirmation = page.getByRole("dialog");
      await confirmation.waitFor();
      await returnFromOverlay();
      await confirmation.waitFor({ state: "hidden" });
      await security.waitFor();
      await page.waitForFunction(el => el === document.activeElement, await clearCache.elementHandle());
      check("settings state, 44px switches, live appearance change, and modal back priority");
      result.passed = true;
      console.log(`PASS ${name}`);
    } catch (error) {
      result.error = String(error.stack || error);
      await page.screenshot({ path: fileURLToPath(new URL(`${name}-failure.png`, output)), animations: "disabled" }).catch(() => {});
      console.error(`FAIL ${name}: ${error.message}`);
    } finally { await context.close(); if (caseBrowser !== browser) await caseBrowser.close(); }
  }
  assert.equal(report.cases.filter(test => !test.passed).length, 0, "All viewport scenarios pass");
  assert.deepEqual(report.errors, [], "No uncaught browser errors");
  assert.deepEqual(report.external, [], "No unexpected requests to live services");
} catch (error) {
  report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
  await browser?.close(); await vite?.close();
  console.log(`Artifacts: ${fileURLToPath(output)}`);
}
