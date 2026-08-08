import {defineConfig} from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30000,
    use: {
        baseURL: 'http://localhost:5199',
    },
    webServer: {
        command: 'npx vite --port 5199 --strictPort',
        port: 5199,
        reuseExistingServer: true,
    },
});
