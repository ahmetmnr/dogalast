#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

console.log('🚀 Initializing local SQLite database...\n');

// Create directory if it doesn't exist
const dbPath = './.wrangler/state/v3/d1/miniflare-D1DatabaseObject/zero-waste-quiz-dev.sqlite';
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
  console.log(`✅ Created directory: ${dbDir}`);
}

// Create/open database
const db = new Database(dbPath);
console.log(`✅ Database created/opened at: ${dbPath}`);

// Read and execute migration files
const migrationFiles = [
  '0001_initial_schema.sql',
  '0002_indexes.sql',
  '0003_fts_setup.sql',
  '0004_audit_triggers.sql',
  '0005_default_data.sql'
];

const migrationsDir = join(process.cwd(), 'src/db/migrations');

for (const file of migrationFiles) {
  const filePath = join(migrationsDir, file);
  
  if (!existsSync(filePath)) {
    console.warn(`⚠️  Migration file not found: ${file}`);
    continue;
  }
  
  try {
    const sql = readFileSync(filePath, 'utf-8');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      db.exec(statement);
    }
    
    console.log(`✅ Applied migration: ${file}`);
  } catch (error) {
    console.error(`❌ Failed to apply migration ${file}:`, error);
  }
}

// Verify tables
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\n📊 Created tables:');
tables.forEach((table: any) => {
  console.log(`   - ${table.name}`);
});

// Add admin user
try {
  // Check if admin exists
  const adminExists = db.query("SELECT id FROM admin_users WHERE username = ?").get('admin');
  
  if (!adminExists) {
    db.exec(`
      INSERT INTO admin_users (username, password_hash, is_active)
      VALUES ('admin', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiGaKrsCdaE2', 1)
    `);
    console.log('\n✅ Admin user created (username: admin, password: admin123)');
  } else {
    console.log('\n✅ Admin user already exists');
  }
} catch (error) {
  console.error('❌ Failed to create admin user:', error);
}

db.close();

console.log('\n✨ Database initialization complete!');
console.log('📝 Database path:', dbPath);
