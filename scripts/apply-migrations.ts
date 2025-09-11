/**
 * Database Migration Script
 * Applies SQL migrations to Cloudflare D1 database
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Logger } from '../src/utils/logger';

// For local development with Miniflare/Wrangler
interface MigrationFile {
  name: string;
  content: string;
  order: number;
}

/**
 * Read all migration files from the migrations directory
 */
async function getMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
  
  try {
    const files = await readdir(migrationsDir);
    
    // Filter SQL files and sort by name
    const sqlFiles = files
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    // Read file contents
    const migrations: MigrationFile[] = [];
    
    for (const file of sqlFiles) {
      const content = await readFile(join(migrationsDir, file), 'utf-8');
      const order = parseInt(file.split('_')[0], 10) || 0;
      
      migrations.push({
        name: file,
        content,
        order,
      });
    }
    
    // Sort by order number
    migrations.sort((a, b) => a.order - b.order);
    
    return migrations;
  } catch (error) {
    Logger.error('Failed to read migration files', error as Error);
    throw error;
  }
}

/**
 * Apply migrations using Wrangler D1 commands
 * Note: This generates commands to run manually
 */
async function generateMigrationCommands(databaseName: string) {
  const migrations = await getMigrationFiles();
  
  console.log('\\n=== D1 Migration Commands ===\\n');
  console.log('Run the following commands to apply migrations:\\n');
  
  for (const migration of migrations) {
    console.log(`# ${migration.name}`);
    console.log(`wrangler d1 execute ${databaseName} --file src/db/migrations/${migration.name}`);
    console.log('');
  }
  
  console.log('\\n=== Verify Migrations ===\\n');
  console.log(`wrangler d1 execute ${databaseName} --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"`);
}

/**
 * Create a combined migration file for easier application
 */
async function createCombinedMigration() {
  const migrations = await getMigrationFiles();
  const outputFile = join(process.cwd(), 'scripts', 'combined-migration.sql');
  
  let combinedContent = '-- Combined Migration File\\n';
  combinedContent += '-- Generated: ' + new Date().toISOString() + '\\n\\n';
  
  for (const migration of migrations) {
    combinedContent += `-- ========================================\\n`;
    combinedContent += `-- Migration: ${migration.name}\\n`;
    combinedContent += `-- ========================================\\n\\n`;
    combinedContent += migration.content;
    combinedContent += '\\n\\n';
  }
  
  // Write combined file
  const { writeFile } = await import('fs/promises');
  await writeFile(outputFile, combinedContent, 'utf-8');
  
  console.log(`\\nCombined migration file created: ${outputFile}`);
  console.log('\\nApply all migrations at once:');
  console.log(`wrangler d1 execute <database-name> --file ${outputFile}`);
}

/**
 * Check migration status (for future implementation)
 */
async function checkMigrationStatus(databaseName: string) {
  console.log('\\n=== Check Migration Status ===\\n');
  console.log('Run this command to check applied migrations:');
  console.log(`wrangler d1 execute ${databaseName} --command "SELECT value FROM system_settings WHERE key = 'LAST_MIGRATION';"`);
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const databaseName = args[0] || 'zero-waste-quiz-dev';
  const command = args[1] || 'generate';
  
  async function run() {
    try {
      console.log('Zero Waste Quiz - Database Migration Tool\\n');
      
      switch (command) {
        case 'generate':
          await generateMigrationCommands(databaseName);
          break;
          
        case 'combine':
          await createCombinedMigration();
          break;
          
        case 'status':
          await checkMigrationStatus(databaseName);
          break;
          
        default:
          console.log('Usage: bun run scripts/apply-migrations.ts <database-name> [command]');
          console.log('Commands:');
          console.log('  generate - Generate wrangler commands (default)');
          console.log('  combine  - Create combined migration file');
          console.log('  status   - Check migration status');
      }
      
    } catch (error) {
      Logger.error('Migration script failed', error as Error);
      process.exit(1);
    }
  }
  
  run();
}

// Export for use in other scripts
export { getMigrationFiles, createCombinedMigration };

