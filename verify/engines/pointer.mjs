const FOCUS_ATTEMPTS = 60;

export const walk = async (page, element, limit = FOCUS_ATTEMPTS) => {
  for (let attempt = 0; attempt < limit; attempt++) {
    await page.keyboard.press("Tab");
    if (await element.evaluate((target) => document.activeElement === target).catch(() => false)) return true;
  }
  return false;
};

const restartFromTop = (page) =>
  page.evaluate(() => {
    const start = document.createElement("span");
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    start.remove();
  });

export async function focus(page, element) {
  const { tabIndex, tabbables } = await element
    .evaluate((target) => {
      let count = 0;
      for (const candidate of document.querySelectorAll("a[href], button, input, select, textarea, details > summary, [tabindex], [contenteditable], iframe")) {
        if (candidate.tabIndex >= 0 && !candidate.disabled && !candidate.closest("[inert]")) count++;
      }
      return { tabIndex: target.tabIndex, tabbables: count };
    })
    .catch(() => ({ tabIndex: -1, tabbables: 0 }));
  if (tabIndex >= 0) {
    const limit = Math.min(FOCUS_ATTEMPTS, tabbables + 2);
    await page.evaluate(() => document.activeElement?.blur());
    if (await walk(page, element, limit)) return true;
    await page.evaluate(() => document.activeElement?.blur());
    await restartFromTop(page).catch(() => {});
    if (await walk(page, element, limit)) return true;
  }
  await page.keyboard.down("Tab");
  await element.focus({ timeout: 1000 }).catch(() => {});
  await page.keyboard.up("Tab");
  return element.evaluate((target) => document.activeElement === target).catch(() => false);
}
