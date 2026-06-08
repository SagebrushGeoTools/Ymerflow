// Playwright tests for WebxtileDataset / GridLayer client-side code.
//
// Run setup first, then run tests:
//   env/bin/python tests/webxtile/setup.py
//   npx playwright test tests/webxtile/test.spec.js --project=chromium

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const IDS_FILE = path.join(__dirname, '.ids.json');

function loadIds() {
    if (!fs.existsSync(IDS_FILE)) {
        throw new Error(`Run tests/webxtile/setup.py first (${IDS_FILE} not found)`);
    }
    return JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));
}

async function login(page, ids) {
    await page.goto('http://localhost:3000/');
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 10_000 });
    await page.fill('input[placeholder="Username"]', ids.username);
    await page.fill('input[placeholder="Password"]', ids.password);
    const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/auth/'), { timeout: 10_000 }),
        page.click('button[type="submit"]'),
    ]);
    if (!response.ok()) throw new Error(`Login failed: ${response.status()}`);
    await page.waitForTimeout(1_000);
}

test.describe('WebxtileDataset / GridLayer', () => {
    let ids;

    test.beforeAll(() => {
        ids = loadIds();
    });

    test('metadata and root tile are fetched on load', async ({ page }) => {
        await login(page, ids);
        const fetched = new Set();
        page.on('request', req => {
            const u = req.url();
            if (u.includes('/files/') && u.includes(ids.dataset_id)) {
                fetched.add(path.basename(u));
            }
        });

        await page.goto(ids.frontend_url);

        // Wait for the PlotView canvas to appear (gladly renders into a <canvas>)
        await page.waitForSelector('canvas', { timeout: 30_000 });

        // Allow time for the initial tile requests
        await page.waitForTimeout(5_000);

        expect(fetched.has('metadata.msgpack'), 'metadata.msgpack should be fetched').toBe(true);
        expect(fetched.has('root.msgpack'),     'root.msgpack should be fetched').toBe(true);
    });

    test('background streamLeaves fetches more tiles over time', async ({ page }) => {
        await login(page, ids);
        const fetched = new Set();
        page.on('request', req => {
            const u = req.url();
            if (u.includes('/files/') && u.includes(ids.dataset_id) && u.endsWith('.msgpack')) {
                fetched.add(path.basename(u));
            }
        });

        await page.goto(ids.frontend_url);
        await page.waitForSelector('canvas', { timeout: 30_000 });

        // Give the background streamLeaves time to fetch a batch of tiles
        await page.waitForTimeout(15_000);

        const count = fetched.size;
        console.log(`Tiles fetched after 15s: ${count}`);

        // Root + metadata + at least a few leaf tiles from streamLeaves
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('canvas redraws when the viewport is panned', async ({ page }) => {
        test.setTimeout(120_000);
        await login(page, ids);

        await page.goto(ids.frontend_url);
        const canvas = await page.waitForSelector('canvas', { timeout: 30_000 });

        // Wait for the initial render to settle with data visible
        await page.waitForTimeout(5_000);

        // Get canvas bounding box once and reuse it
        const box = await canvas.boundingBox();
        const cx = box.x + box.width  / 2;
        const cy = box.y + box.height / 2;

        // Screenshot before pan
        const screenshotBefore = await page.screenshot({ clip: box });

        // Pan the canvas — 2 steps to minimise GPU stall from mousemove events
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 200, cy + 100, { steps: 2 });
        await page.mouse.up();

        // Allow time for the viewport change to trigger a loadBBox + redraw
        await page.waitForTimeout(4_000);

        // Screenshot after pan using the same clip rectangle
        const screenshotAfter = await page.screenshot({ clip: box });

        // The screenshots should differ — the view shifted
        expect(screenshotBefore.length).toBeGreaterThan(0);
        expect(screenshotAfter.length).toBeGreaterThan(0);
        const changed = !screenshotBefore.equals(screenshotAfter);
        console.log('Canvas changed after pan:', changed,
            `(${screenshotBefore.length} vs ${screenshotAfter.length} bytes)`);
        expect(changed, 'Canvas should render differently after panning').toBe(true);
    });

    test('no console errors during tile loading', async ({ page }) => {
        await login(page, ids);
        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        page.on('pageerror', err => errors.push(err.message));

        await page.goto(ids.frontend_url);
        await page.waitForSelector('canvas', { timeout: 30_000 });
        await page.waitForTimeout(5_000);

        const webxtileErrors = errors.filter(e =>
            e.toLowerCase().includes('webxtile') ||
            e.toLowerCase().includes('tile') ||
            e.toLowerCase().includes('msgpack')
        );
        expect(webxtileErrors).toEqual([]);
    });
});
