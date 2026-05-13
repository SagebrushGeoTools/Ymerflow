const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: '.',
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:3000',
        headless: true,
        viewport: { width: 1280, height: 800 },
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
