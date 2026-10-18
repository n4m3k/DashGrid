import { test, expect } from '@playwright/test';

test('dashboard editing, push updates, thresholds, mobile and cross-screen synchronization', async ({
  page,
  context,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Infrastructure', exact: true })).toBeVisible();
  await expect(page.getByText('En direct', { exact: true })).toBeVisible();
  await expect(page.locator('article.tile')).toHaveCount(12);
  const memory = page
    .locator('article.tile')
    .filter({ has: page.getByRole('heading', { name: 'Mémoire', exact: true }) });
  expect((await memory.boundingBox())!.height).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  const cpuCard = page
    .locator('article.tile')
    .filter({ has: page.getByRole('heading', { name: 'CPU · production', exact: true }) });
  async function swapCpuAndMemory(expectedX: number) {
    const handle = (await cpuCard.locator('.drag-handle').boundingBox())!;
    const cpuBox = (await cpuCard.boundingBox())!;
    const memoryBox = (await memory.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + memoryBox.x - cpuBox.x,
      handle.y + handle.height / 2,
      { steps: 15 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/dashboard')).json()).tiles.find(
            (tile: { id: string }) => tile.id === 'cpu',
          ).layout.x,
      )
      .toBe(expectedX);
    await expect
      .poll(async () => Math.round((await cpuCard.boundingBox())!.x))
      .toBe(Math.round(memoryBox.x));
    await expect
      .poll(async () => Math.round((await memory.boundingBox())!.x))
      .toBe(Math.round(cpuBox.x));
  }
  await swapCpuAndMemory(4);
  await swapCpuAndMemory(2);
  await page.getByRole('button', { name: 'Modifier CPU · production', exact: true }).click();
  await page.getByLabel('Titre', { exact: true }).fill('CPU de test');
  await page.getByRole('button', { name: 'Couleurs & seuils' }).click();
  await page.getByLabel('Valeur de test').fill('91');
  await page.getByRole('button', { name: 'Tester', exact: true }).click();
  await expect(page.locator('.preview-result')).toContainText('Critique');
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'CPU de test', exact: true })).toBeVisible();
  const pushed = await request.post('/api/v1/tiles/cpu/data', { data: { value: 91 } });
  expect(pushed.ok()).toBeTruthy();
  const cpu = page
    .locator('article.tile')
    .filter({ has: page.getByRole('heading', { name: 'CPU de test', exact: true }) });
  await expect(cpu.locator('.tile-value')).toContainText('91');
  await expect(
    second
      .locator('article.tile')
      .filter({ has: second.getByRole('heading', { name: 'CPU de test', exact: true }) })
      .locator('.tile-value'),
  ).toContainText('91');
  await expect(cpu).toHaveCSS('background-color', 'rgb(255, 111, 105)');
  await page.getByRole('button', { name: 'Ajouter une tuile' }).click();
  await page.getByLabel('Titre', { exact: true }).fill('Nouvelle métrique');
  await page.getByLabel('Envoyer une valeur à l’enregistrement').check();
  await page.getByLabel('Valeur', { exact: true }).fill('37');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nouvelle métrique', exact: true })).toBeVisible();
  const newCard = page
    .locator('article.tile')
    .filter({ has: page.getByRole('heading', { name: 'Nouvelle métrique', exact: true }) });
  const resize = newCard.locator('..').locator('.react-resizable-handle');
  await resize.scrollIntoViewIfNeeded();
  const resizeBox = (await resize.boundingBox())!;
  const columnWidth = ((await newCard.boundingBox())!.width + 6) / 2;
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 + columnWidth,
    resizeBox.y + resizeBox.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/v1/dashboard')).json()).tiles.find(
          (tile: { content: { title: string } }) => tile.content.title === 'Nouvelle métrique',
        ).layout.w,
    )
    .toBe(3);
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await expect(page.locator('main.app')).toHaveClass(/theme-outline/);
  await page.screenshot({ path: testInfo.outputPath('dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await expect(page.locator('main.app')).toHaveClass(/theme-pastel/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-grid')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  // Restore the seed configuration so this test can be rerun against a persistent test database.
  const snapshot = await (await request.get('/api/v1/dashboard')).json();
  const added = snapshot.tiles.find(
    (tile: { content: { title: string } }) => tile.content.title === 'Nouvelle métrique',
  );
  await request.delete(`/api/v1/tiles/${added.id}`);
  await request.patch('/api/v1/tiles/cpu', {
    data: { content: { title: 'CPU · production' }, demo: true },
  });
  await request.post('/api/v1/tiles/cpu/data', { data: { value: 42 } });
  await request.patch('/api/v1/tiles/cpu', { data: { demo: true } });
  await request.patch('/api/v1/dashboard', { data: { rows: 4 } });
  await second.close();
});
