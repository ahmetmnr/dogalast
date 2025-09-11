import type { Config } from 'drizzle-kit';

export default {
    schema: './src/db/schema.ts',
    out: './src/db/migrations/drizzle',
    driver: 'd1',
    dbCredentials: {
        wranglerConfigPath: 'wrangler.toml',
        dbName: 'DB' // This should match the binding name in wrangler.toml
    },
    verbose: true,
    strict: true
} satisfies Config;


