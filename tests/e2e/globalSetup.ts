/**
 * Playwright globalSetup. We rely on `bun run tests/e2e/seed.ts` having been
 * executed BEFORE Playwright starts (via the `bun run test:e2e` chained
 * command in package.json), so the SQLite file is already migrated and seeded
 * before the webServer launches. globalSetup itself only verifies the file
 * exists — re-seeding here would unlink the file out from under the running
 * webServer's Prisma client (Unix inode semantics) and every subsequent write
 * would surface as "attempt to write a readonly database".
 */
import { existsSync } from 'node:fs';

import { E2E_CONFIG } from '../../playwright.config';

export default async function globalSetup(): Promise<void> {
  const url = E2E_CONFIG.databaseUrl;
  if (!url.startsWith('file:')) return;
  const path = url.slice('file:'.length);
  if (!existsSync(path)) {
    throw new Error(
      `E2E database not found at ${path}. Run \`bun run tests/e2e/seed.ts\` first ` +
        `(or use \`bun run test:e2e\` which seeds before starting Playwright).`,
    );
  }
}
