import { defineConfig, devices } from '@playwright/test';

/**
 * The ILM Administrator frontend must be running at BASE_URL
 * (Vite dev server proxying /api to the Core backend with the
 * dummy admin certificate injected — see the local setup guide).
 */
export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: {
        timeout: 15_000,
    },
    // Certificate upload/delete mutate shared platform state — run serially.
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: [['html', { open: 'never' }], ['list']],
    use: {
        baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Demo mode: SLOWMO=500 npm run test:headed — slows every action down (ms).
        launchOptions: {
            slowMo: process.env.SLOWMO ? Number(process.env.SLOWMO) : 0,
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
