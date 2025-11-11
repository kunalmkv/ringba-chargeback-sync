// Service to refresh auth cookies every 3 days using a one-time Puppeteer login
import * as TE from 'fp-ts/lib/TaskEither.js';
import { scrapingOps } from '../scrapers/elocal-scraper.js';
import { writeSession, createSessionFromCookies } from '../auth/session-store.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export const refreshAuthSession = (config) =>
  TE.tryCatch(
    async () => {
      const scraper = scrapingOps(config);
      const browser = await TE.getOrElse(() => { throw new Error('Failed to launch browser'); })(scraper.createBrowser())();
      try {
        const page = await browser.newPage();
        await TE.getOrElse(() => { throw new Error('Failed to configure page'); })(scraper.configurePage(page)(config))();
        await TE.getOrElse(() => { throw new Error('Login failed'); })(scraper.loginToElocal(page))();

        // After login, capture cookies
        const cookies = await page.cookies();
        const session = createSessionFromCookies(cookies, THREE_DAYS_MS);
        await writeSession(session);
        return { success: true, expiresAt: session.expiresAt };
      } finally {
        await browser.close();
      }
    },
    (error) => new Error(`Auth session refresh failed: ${error.message}`)
  );


