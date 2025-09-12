import { Database } from 'bun:sqlite';

const db = new Database('./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/zero-waste-quiz-dev.sqlite');

// Clear active sessions
const result = db.run('UPDATE quiz_sessions SET status = ? WHERE status = ?', 'completed', 'active');
console.log(`✅ ${result.changes} active sessions cleared!`);

// Show current sessions
const sessions = db.query('SELECT id, participant_id, status FROM quiz_sessions ORDER BY started_at DESC LIMIT 5').all();
console.log('Recent sessions:', sessions);
