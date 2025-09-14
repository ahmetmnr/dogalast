/**
 * Fix Timing Indexes Script
 * Removes problematic unixepoch() index and creates proper covering index
 */

import Database from 'bun:sqlite';

// Load environment variables
const DATABASE_URL = process.env.DATABASE_URL || './.wrangler/state/v3/d1/miniflare-D1DatabaseObject/zero-waste-quiz-dev.sqlite';

async function fixTimingIndexes() {
  console.log('🔧 Fixing timing indexes...');

  // Connect to database
  const sqlite = new Database(DATABASE_URL);

  try {
    // Drop problematic index
    console.log('🗑️  Dropping problematic index with unixepoch()...');
    sqlite.run('DROP INDEX IF EXISTS idx_question_timings_active');

    // Create new covering index
    console.log('📝 Creating new covering index...');
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_question_timings_covering
      ON question_timings(
        session_question_id,
        event_type,
        server_timestamp
      )`);

    console.log('✅ Timing indexes fixed successfully!');
    console.log('📊 Verifying indexes...');

    // List all indexes on question_timings table
    const indexes = sqlite.query(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type='index'
      AND tbl_name='question_timings'
      ORDER BY name
    `).all();

    console.log('📋 Current indexes on question_timings:');
    for (const index of indexes) {
      console.log(`  - ${(index as any).name}: ${(index as any).sql || 'System index'}`);
    }

  } catch (error) {
    console.error('❌ Error fixing timing indexes:', error);
    process.exit(1);
  } finally {
    sqlite.close();
  }

  console.log('🎉 Migration completed successfully!');
}

// Run the fix
fixTimingIndexes().catch(console.error);