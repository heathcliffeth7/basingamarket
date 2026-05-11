import { expect, test } from '@playwright/test';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

test('markets route shows the cleaned top-nav market feed', async ({ page }) => {
  await page.goto('/markets');
  const sidebar = page.getByLabel('App navigation');
  await expect(sidebar).toHaveCount(0);
  await expect(page.getByLabel('Top navigation')).toBeVisible();
  const topCategories = page.getByRole('navigation', { name: 'Market categories' });
  await expect(topCategories).toBeVisible();
  const categoryLinks = topCategories.getByRole('link');
  await expect(categoryLinks).toHaveCount(5);
  for (const category of ['Trending', 'New', 'Sports', 'Crypto', 'Finance']) {
    await expect(topCategories.getByRole('link', { name: new RegExp(category) })).toBeVisible();
  }
  for (const unsupported of ['Politics', 'Tech', 'Culture', 'Economy', 'More']) {
    await expect(topCategories.getByText(unsupported, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel('Rewards')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Login' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Login' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign up' })).toHaveCount(0);
  await expect(page.getByLabel('Deposit')).toHaveCount(0);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  if (viewportWidth >= 768) {
    await expect(page.getByLabel('Global market search')).toBeVisible();
  }
  const logo = page.locator('img[src="/brand/bm-logo-mark.svg"]:visible').first();
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Markets', exact: true })).toBeVisible();
  await expect(page.getByText(/MOCK/).first()).toBeVisible();
  const firstMarket = page.getByText('BTC 5m Crypto Round').first();
  const emptyState = page.getByText('No markets match this search.');
  await expect(firstMarket.or(emptyState)).toBeVisible();
  if (await firstMarket.isVisible()) {
    await expect(page.getByText(/Crowd leans/).first()).toBeVisible();
    await page.getByLabel('Search markets').fill('btc');
    await expect(page.getByText('BTC 5m Crypto Round')).toBeVisible();
    await expect(page.getByText('ETH 5m Crypto Round')).toHaveCount(0);
  } else {
    await expect(emptyState).toBeVisible();
  }
});

test('auth CTAs open Privy modal and legacy routes redirect', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/markets$/);
  await page.getByRole('button', { name: 'Login' }).first().click();
  await expect(page.getByRole('dialog').getByText('Log in or sign up')).toBeVisible({ timeout: 15_000 });

  await page.goto('/signup');
  await expect(page).toHaveURL(/\/markets$/);
  await page.getByRole('button', { name: 'Sign up' }).first().click();
  await expect(page.getByRole('dialog').getByText('Log in or sign up')).toBeVisible({ timeout: 15_000 });
});

test('market detail makes the asset price chart the primary surface', async ({ page }) => {
  await page.goto('/markets/btc-updown-5m-1778413500');
  const viewport = page.viewportSize();
  const pulseStrip = page.getByLabel('Market pulse strip');
  if ((viewport?.width ?? 0) >= 1280) {
    await expect(pulseStrip).toBeHidden();
    const marketRead = page.getByLabel('Market read');
    await expect(marketRead).toBeVisible();
    await expect(marketRead.getByText(/Market leans|Crowd leans UP/)).toBeVisible();
    await expect(marketRead.getByText('Go to live market')).toBeVisible();
    await expect(page.getByText('Outcome: Yes')).toHaveCount(0);
  } else {
    await expect(pulseStrip).toBeVisible();
    await expect(pulseStrip.getByText('Crowd leans UP')).toBeVisible();
  }
  const chart = page.getByLabel('Asset price round chart');
  await expect(chart).toBeVisible();
  await expect(chart.getByRole('heading', { name: 'BTC Up or Down 5m' })).toBeVisible();
  await expect(chart.getByText('Price To Beat')).toBeVisible();
  await expect(chart.getByText(/Current Price|Final price/)).toBeVisible();
  await expect(page.getByText('$35,580.00')).toHaveCount(0);
  await expect(page.getByText('$35,567.28')).toHaveCount(0);
  await expect(chart.locator('[data-testid="asset-price-line"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refetch' })).toHaveCount(0);
  const roundRail = page.getByLabel('Past crypto rounds');
  await expect(roundRail.locator('[data-testid="live-round-dot"]').first()).toBeVisible();
  await expect(roundRail.getByText('More', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="go-live-market"]').first()).toBeVisible();
  await expect(page.getByLabel('Outcome chips')).toHaveCount(0);
  const orderBook = page.getByLabel('Market order book');
  await expect(orderBook).toBeVisible();
  await expect(orderBook).toHaveAttribute('data-density', 'compact');
  await expect(orderBook.getByText('Order book')).toBeVisible();
  await expect(orderBook.getByText('Bonding curve depth')).toBeVisible();
  for (const column of ['Side', 'Price', 'Amount', 'Total USD']) {
    await expect(orderBook.getByText(column)).toBeVisible();
  }
  await expect(orderBook.getByText('UP token').first()).toBeVisible();
  await expect(orderBook.getByRole('button')).toHaveCount(0);
  const box = await chart.boundingBox();
  const orderBookBox = await orderBook.boundingBox();
  expect(box).not.toBeNull();
  expect(orderBookBox).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.3);
  const visibleActionPanel = page.locator('aside[aria-label="Market action panel"]:visible');
  if ((viewport?.width ?? 0) >= 1280) {
    await expect(visibleActionPanel).toBeVisible();
    const actionPanelBox = await visibleActionPanel.boundingBox();
    expect(actionPanelBox).not.toBeNull();
    expect((orderBookBox?.x ?? 0) + (orderBookBox?.width ?? 0)).toBeLessThan(box?.x ?? 0);
    expect(actionPanelBox?.x ?? 0).toBeGreaterThan((box?.x ?? 0) + (box?.width ?? 0));
    expect(Math.abs((orderBookBox?.y ?? 0) - (box?.y ?? 0))).toBeLessThanOrEqual(8);
    expect(Math.abs((actionPanelBox?.y ?? 0) - (box?.y ?? 0))).toBeLessThanOrEqual(8);
    const pastBox = await roundRail.getByText('Past', { exact: true }).boundingBox();
    const moreBox = await roundRail.getByText('More', { exact: true }).boundingBox();
    expect(pastBox).not.toBeNull();
    expect(moreBox).not.toBeNull();
    expect(Math.abs((moreBox?.y ?? 0) - (pastBox?.y ?? 0))).toBeLessThanOrEqual(6);
  } else {
    await expect(visibleActionPanel).toHaveCount(0);
    await page.getByRole('button', { name: /Trade intents/ }).click();
    await expect(visibleActionPanel).toBeVisible();
  }
  await expect(page.getByLabel('Secondary signal panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Details' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Listed tickets' })).toHaveCount(0);
  await expect(page.getByText(/Activity|trades|Trader|Related tickets|Ticket #|staked/i)).toHaveCount(0);
  if ((viewport?.width ?? 0) >= 1280) {
    await expect(page.getByLabel('Market read').getByText(/Mock/i).first()).toBeVisible();
  } else {
    await expect(page.getByText(/MOCK/).first()).toBeVisible();
  }
});

test('live market action panel hides the live-market CTA', async ({ page }) => {
  await page.goto('/markets/1');
  const viewport = page.viewportSize();
  const visibleActionPanel = page.locator('aside[aria-label="Market action panel"]:visible');
  const chart = page.getByLabel('Asset price round chart');

  if ((viewport?.width ?? 0) < 1280) {
    await page.getByRole('button', { name: /Trade intents/ }).click();
  }

  await expect(chart.locator('[data-testid="asset-price-canvas"]')).toBeVisible();
  await expect(chart.locator('[data-testid="asset-price-line"]')).toHaveCount(0);
  await expect(chart.locator('number-flow-react').first()).toBeVisible();
  await expect(page.getByText('$35,580.00')).toHaveCount(0);
  await expect(page.getByText('$35,567.28')).toHaveCount(0);
  await expect(visibleActionPanel).toBeVisible();
  const marketRead = visibleActionPanel.getByLabel('Market read');
  await expect(marketRead.getByText(/Market leans|Crowd leans UP/)).toBeVisible();
  await expect(marketRead.getByText('Go to live market')).toHaveCount(0);
});

test('market detail keeps the desktop price chart above the fold at 1024px tall', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'desktop-only compact layout check');
  await page.setViewportSize({ width: 2048, height: 1024 });
  await page.goto('/markets/1');
  const chart = page.getByLabel('Asset price round chart');
  await expect(chart).toBeVisible();
  const categoryLink = page.getByRole('navigation', { name: 'Market categories' }).getByRole('link').first();
  await expect.poll(() => categoryLink.evaluate((element) => getComputedStyle(element).fontSize)).toBe('15px');
  const box = await chart.boundingBox();
  const orderBookBox = await page.getByLabel('Market order book').boundingBox();
  const actionPanelBox = await page.locator('aside[aria-label="Market action panel"]:visible').boundingBox();
  expect(box).not.toBeNull();
  expect(orderBookBox).not.toBeNull();
  expect(actionPanelBox).not.toBeNull();
  expect((orderBookBox?.x ?? 0) + (orderBookBox?.width ?? 0)).toBeLessThan(box?.x ?? 0);
  expect(actionPanelBox?.x ?? 0).toBeGreaterThan((box?.x ?? 0) + (box?.width ?? 0));
  expect(Math.abs((orderBookBox?.y ?? 0) - (box?.y ?? 0))).toBeLessThanOrEqual(8);
  expect(Math.abs((actionPanelBox?.y ?? 0) - (box?.y ?? 0))).toBeLessThanOrEqual(8);
  expect(orderBookBox?.width ?? 0).toBeLessThanOrEqual(370);
  expect(actionPanelBox?.width ?? 0).toBeLessThanOrEqual(370);
  expect(box?.y ?? 0).toBeLessThanOrEqual(220);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(1050);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(1040);
});

test('ticket and profile routes render intent states', async ({ page }) => {
  await page.goto('/tickets/1');
  await expect(page.getByRole('heading', { name: 'Ticket #1' })).toBeVisible();
  await expect(page.getByText('position receipt')).toBeVisible();
  const listIntent = page.getByRole('button', { name: /List intent/ });
  await expect(listIntent).toBeVisible();
  await expect(page.getByText('Wallet transaction required')).toBeVisible();
  await expect(listIntent).toBeEnabled({ timeout: 15_000 });
  await listIntent.click();
  await expect(page).toHaveURL(/\/tickets\/1/);
  await expect(page.getByRole('dialog').getByText('Log in or sign up')).toBeVisible({ timeout: 15_000 });

  await page.goto(`/profiles/${SOLANA_DEVNET_PUBKEY}`);
  await expect(page.getByText('forecast identity')).toBeVisible();
  await expect(page.getByText(/projection/).first()).toBeVisible();
});
