/**
 * Database Setup Script for Production
 * Creates Cloudflare D1 database and runs initial setup
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ENVIRONMENT = process.env.NODE_ENV || 'production';
const DB_NAME = 'zero-waste-quiz-db';

console.log(`🗄️ Setting up database for ${ENVIRONMENT} environment...`);

async function setupDatabase() {
  try {
    // 1. Create D1 database
    console.log('📊 Creating Cloudflare D1 database...');
    
    try {
      const createResult = execSync(`npx wrangler d1 create ${DB_NAME}`, { 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      
      console.log('✅ Database created:', createResult);
      
      // Extract database ID from output
      const dbIdMatch = createResult.match(/database_id = "([^"]+)"/);
      if (dbIdMatch) {
        const databaseId = dbIdMatch[1];
        console.log(`📝 Database ID: ${databaseId}`);
        console.log(`🔧 Add this to your wrangler.toml:`);
        console.log(`
[[d1_databases]]
binding = "DB"
database_name = "${DB_NAME}"
database_id = "${databaseId}"
`);
      }
      
    } catch (error) {
      if (error.toString().includes('already exists')) {
        console.log('ℹ️ Database already exists, continuing...');
      } else {
        throw error;
      }
    }

    // 2. List databases to verify
    console.log('📋 Listing existing databases...');
    const listResult = execSync('npx wrangler d1 list', { encoding: 'utf-8' });
    console.log(listResult);

    // 3. Run schema migrations
    console.log('🔄 Running schema migrations...');
    
    const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
    if (existsSync(schemaPath)) {
      const schemaSql = readFileSync(schemaPath, 'utf-8');
      
      // Split schema into individual statements
      const statements = schemaSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of statements) {
        try {
          console.log(`📝 Executing: ${statement.substring(0, 50)}...`);
          execSync(`npx wrangler d1 execute ${DB_NAME} --command "${statement};"`, {
            encoding: 'utf-8',
            stdio: 'inherit'
          });
        } catch (error) {
          if (error.toString().includes('already exists')) {
            console.log('ℹ️ Table already exists, skipping...');
          } else {
            console.error('❌ Error executing statement:', error);
          }
        }
      }
    }

    // 4. Seed initial data
    console.log('🌱 Seeding initial data...');
    await seedDatabase();

    console.log('✅ Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

async function seedDatabase() {
  // Admin user creation
  const adminPasswordHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiGaKrsCdaE2'; // admin123
  
  const adminQuery = `
    INSERT OR IGNORE INTO participants (email, name, password_hash, is_admin, created_at)
    VALUES ('admin@sifiratiketkinligi.com', 'Admin User', '${adminPasswordHash}', 1, datetime('now'));
  `;

  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --command "${adminQuery}"`, {
      encoding: 'utf-8',
      stdio: 'inherit'
    });
    console.log('✅ Admin user created');
  } catch (error) {
    console.log('ℹ️ Admin user might already exist');
  }

  // Quiz questions seeding
  console.log('📝 Adding quiz questions...');
  
  const questions = [
    {
      id: 'q1',
      type: 'mcq',
      question: 'Sıfır Atık sisteminde atıklar kaç ana kategoriye ayrılır ve renk kodları nelerdir?',
      options: JSON.stringify([
        'A) 4 kategori: Plastik, Metal, Kağıt, Cam',
        'B) 6 kategori: Plastik (sarı), Metal (gri), Kağıt (mavi), Cam (yeşil), Biyobozunur (kahverengi), Diğer Atıklar (gri)',
        'C) 3 kategori: Kağıt, Plastik, Cam',
        'D) 5 kategori: Karışık sistem'
      ]),
      correct_answer: '6 kategori: Plastik (sarı), Metal (gri), Kağıt (mavi), Cam (yeşil), Biyobozunur (kahverengi), Diğer Atıklar (gri)',
      points: 10,
      difficulty: 'medium'
    },
    {
      id: 'q2',
      type: 'open',
      question: "Türkiye'de Sıfır Atık Projesi'nin başladığı 2017 yılında geri dönüşüm oranı yüzde 13'tü. 2024 yılında bu oran kaça yükseldi?",
      correct_answer: '36,08 yüzde',
      points: 10,
      difficulty: 'medium'
    }
  ];

  for (const q of questions) {
    const questionQuery = `
      INSERT OR IGNORE INTO quiz_questions (
        id, type, question_text, options, correct_answer, points, difficulty, created_at
      ) VALUES (
        '${q.id}',
        '${q.type}',
        '${q.question}',
        '${q.options || 'null'}',
        '${q.correct_answer}',
        ${q.points},
        '${q.difficulty}',
        datetime('now')
      );
    `;

    try {
      execSync(`npx wrangler d1 execute ${DB_NAME} --command "${questionQuery}"`, {
        encoding: 'utf-8',
        stdio: 'inherit'
      });
    } catch (error) {
      console.log(`ℹ️ Question ${q.id} might already exist`);
    }
  }

  console.log('✅ Quiz questions added');
}

// Run the setup
setupDatabase();

