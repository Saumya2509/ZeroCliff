import { expect, test } from "@playwright/test";

// Quality floor from 04: every page renders at phone and projector widths, no console errors,
// no horizontal scroll, and no requests leave localhost (the offline finale requirement).

const pages = ["/", "/app", "/simulate", "/transparency", "/how-it-works", "/admin"];

for (const path of pages) {
  test(`${path} renders cleanly`, async ({ page }, info) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
    });

    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.locator("h1").first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);

    await page.screenshot({ path: `e2e/screens/${info.project.name}${path === "/" ? "/home" : path}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
    expect(external, "external requests").toEqual([]);
  });
}

test("app preview reacts when scrubbed into the crash", async ({ page }, info) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  // wait until React has hydrated (the play button is interactive) before moving the slider
  await expect(page.getByRole("button", { name: /Play the crash/ })).toBeEnabled();
  const meter = page.getByRole("meter", { name: "Position health" });
  await expect(meter).toHaveAttribute("aria-valuetext", /safe/);
  const slider = page.getByLabel("Time in the crash");
  await slider.fill("45"); // ~minute 18, mid-descent
  await expect(meter).toHaveAttribute("aria-valuetext", /gliding|backstop/);
  await page.screenshot({ path: `e2e/screens/${info.project.name}/app-mid-crash.png`, fullPage: true });
});

test("cascade lab runs a shared scenario in a worker and downloads the result", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/simulate?crash=aug-2024&beta=0.2", { waitUntil: "networkidle" });
  // the scenario comes from the URL
  await expect(page.getByLabel("Crash")).toHaveValue("aug-2024");
  await expect(page.getByLabel(/^β/)).toHaveValue("0.2");
  // the engine finishes in the worker and the result table appears
  await expect(page.getByText(/^Ran [\d,]+ steps\.$/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table").first()).toContainText("Cascade depth");
  // changing a parameter updates the address bar
  await page.getByLabel("Crash").selectOption("may-2021");
  await expect(page).toHaveURL(/crash=may-2021/);
  await expect(page.getByText(/^Ran [\d,]+ steps\.$/)).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download results (JSON)" }).click();
  expect((await download).suggestedFilename()).toBe("cascade-lab-may-2021-beta0.2.json");
  // experiments section is built from public/results
  for (const id of ["E1", "E2", "E3", "E4", "E5", "E6", "E7"]) await expect(page.locator(`[data-experiment="${id}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});
