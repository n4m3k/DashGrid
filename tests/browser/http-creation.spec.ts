import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';

test('create a first tile, add rules and duplicate without crypto.randomUUID', async ({ page }) => {
  const { app } = await createApp({
    database: ':memory:',
    seed: false,
    scheduler: false,
    token: '',
  });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Localhost is a secure context in Chromium. Reproduce the API surface of HTTP on a LAN IP.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  try {
    await page.goto(address);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    await page.getByRole('button', { name: 'Créer une tuile', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const id = await page.getByLabel('Identifiant', { exact: true }).inputValue();
    expect(id).toMatch(/^tuile-[a-f0-9]{8}$/);
    await page.getByLabel('Titre', { exact: true }).fill('Création sur HTTP');
    await page.getByRole('button', { name: 'Couleurs & seuils', exact: true }).click();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const firstRule = await page.getByLabel('Nom de règle 1', { exact: true }).inputValue();
    const secondRule = await page.getByLabel('Nom de règle 2', { exact: true }).inputValue();
    expect(firstRule).toMatch(/^regle-[a-f0-9]{6}$/);
    expect(secondRule).not.toBe(firstRule);
    await page.getByRole('button', { name: 'Contenu', exact: true }).click();
    await page.getByLabel('Envoyer une valeur à l’enregistrement').check();
    await page.getByLabel('Valeur', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Création sur HTTP', exact: true }),
    ).toBeVisible();
    let snapshot = (await app.inject('/api/v1/dashboard')).json();
    expect(snapshot.tiles).toHaveLength(1);
    expect(snapshot.tiles[0].id).toBe(id);
    expect(snapshot.tiles[0].runtime.data.value).toBe(10);
    expect(snapshot.tiles[0].thresholds.rules).toHaveLength(2);
    await page.getByRole('button', { name: 'Dupliquer Création sur HTTP', exact: true }).click();
    await expect(page.locator('article.tile')).toHaveCount(2);
    snapshot = (await app.inject('/api/v1/dashboard')).json();
    const copy = snapshot.tiles.find((tile: { id: string }) => tile.id !== id);
    expect(copy.id).toMatch(new RegExp(`^${id}-[a-f0-9]{8}$`));
    expect(copy.runtime.data.value).toBe(10);
    await expect(page.locator('.toast.error')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await app.close();
  }
});
