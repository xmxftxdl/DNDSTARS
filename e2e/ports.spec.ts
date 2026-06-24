import { expect, test } from '@playwright/test'

test('DM and player ports load', async ({ browser }) => {
  const context = await browser.newContext()
  const dm = await context.newPage()
  const player = await context.newPage()

  // [T-P1-422/AC3] Point at the playwright-managed dev servers (6173 DM / 6174 Player from
  // playwright.config.ts webServer) so `npm run e2e` runs this spec COLD — no manual PS1 launch
  // and no prebuilt dist/ required. (The 5173/5174 production static-serve path is exercised by
  // the spawned-subprocess HTTP tests in src/lib/sharedServerHttp.test.ts instead.)
  await Promise.all([
    dm.goto('http://127.0.0.1:6173', { waitUntil: 'domcontentloaded' }),
    player.goto('http://127.0.0.1:6174', { waitUntil: 'domcontentloaded' }),
  ])

  await expect(dm.locator('body')).toBeVisible()
  await expect(player.locator('body')).toBeVisible()

  await expect
    .poll(async () => (await dm.locator('body').innerText()).trim().length)
    .toBeGreaterThan(0)
  await expect
    .poll(async () => (await player.locator('body').innerText()).trim().length)
    .toBeGreaterThan(0)

  await context.close()
})
