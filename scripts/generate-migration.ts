/**
 * Generate Drizzle Migration Script
 * Bu script schema.ts'den migration dosyaları üretir
 */

import { execSync } from 'child_process';

const ENVIRONMENT = process.env.NODE_ENV || 'development';

console.log(`🔄 Generating Drizzle migration for ${ENVIRONMENT}...`);

try {
  // Generate migration from schema.ts
  console.log('📝 Generating migration files...');
  
  const generateCmd = 'npx drizzle-kit generate:sqlite --schema=src/db/schema.ts --out=migrations';
  
  const result = execSync(generateCmd, { 
    encoding: 'utf-8',
    stdio: 'inherit'
  });
  
  console.log('✅ Migration files generated successfully!');
  console.log('📁 Check the ./migrations folder for generated files');
  
  // Show generated files
  try {
    const listFiles = execSync('ls -la migrations/', { encoding: 'utf-8' });
    console.log('\n📋 Generated migration files:');
    console.log(listFiles);
  } catch (error) {
    console.log('ℹ️ Could not list migration files (might be Windows)');
  }
  
} catch (error) {
  console.error('❌ Migration generation failed:', error);
  process.exit(1);
}

