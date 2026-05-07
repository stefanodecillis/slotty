/**
 * Prisma seed entrypoint. Phase 0 has nothing to seed — the first user
 * is created via the /setup flow on first boot. This file exists so
 * `prisma migrate dev` doesn't error on the configured seed script.
 */
export {};

async function main() {
  console.log('No seeding to do. Visit /setup to create the admin account.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
