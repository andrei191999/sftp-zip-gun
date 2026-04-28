import { defineConfig, ReporterDescription } from '@playwright/test';
import 'dotenv/config';

const HEADED = process.env.HEADED !== '0';
const SLOW_MO = Number(process.env.SLOW_MO) || 0;
const WORKERS = Number(process.env.WORKERS) || 1;
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 120_000;
const TRACE = process.env.TRACE === '1';

const reporter: ReporterDescription[] =
  WORKERS > 1
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']];

export default defineConfig({
  testDir: './scripts/playwright',
  timeout: TIMEOUT,
  workers: WORKERS,
  fullyParallel: false,
  retries: WORKERS > 1 ? 1 : 0,
  reporter,
  use: {
    headless: !HEADED,
    launchOptions: { slowMo: SLOW_MO },
    trace: TRACE ? 'on' : 'off',
  },
});
