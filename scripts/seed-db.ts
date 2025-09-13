/**
 * Database Seeding Script
 * Loads test data into the database
 */

import { createDatabaseConnection, type DatabaseInstance } from '../src/db/connection';
import * as schema from '../src/db/schema';
import { createLogger, type Env } from '../src/config/environment';
import { eq, sql } from 'drizzle-orm';

const Logger = createLogger('seed-db');

// Import seed data
import questionsData from '../src/db/seeds/questions.json';
import knowledgeData from '../src/db/seeds/knowledge-base.json';

/**
 * Seed database with test data
 * @param env Environment configuration
 */
async function seedDatabase(env: Env) {
  const db = createDatabaseConnection(env);
  
  try {
    Logger.info('Starting database seeding...');
    
    // Seed questions
    await seedQuestions(db);
    
    // Seed knowledge base
    await seedKnowledge(db);
    
    // Create test participant
    await createTestParticipant(db);
    
    // Update system settings
    await updateSystemSettings(db);
    
    Logger.info('Database seeding completed successfully');
    
  } catch (error) {
    Logger.error('Database seeding failed', error as Error);
    throw error;
  }
}

/**
 * Seed questions table
 */
async function seedQuestions(db: DatabaseInstance) {
  Logger.info('Seeding questions...');
  
  for (const question of questionsData) {
    try {
      await db.insert(schema.questions).values({
        id: question.id,
        orderNo: question.orderNo,
        text: question.text,
        correctAnswer: question.correctAnswer,
        options: JSON.stringify(question.options),
        difficulty: question.difficulty,
        basePoints: question.basePoints,
        timeLimit: question.timeLimit,
        category: question.category,
        isActive: question.isActive ? 1 : 0,
      }).onConflictDoNothing();
      
      Logger.debug(`Inserted question: ${question.id}`);
    } catch (error) {
      Logger.error(`Failed to insert question ${question.id}`, error as Error);
    }
  }
  
  Logger.info(`Seeded ${questionsData.length} questions`);
}

/**
 * Seed knowledge base
 */
async function seedKnowledge(db: DatabaseInstance) {
  Logger.info('Seeding knowledge base...');
  
  for (const knowledge of knowledgeData) {
    try {
      const result = await db.insert(schema.knowledge).values({
        title: knowledge.title,
        content: knowledge.content,
        tags: knowledge.tags,
        category: knowledge.category,
        confidenceScore: knowledge.confidenceScore,
        isActive: 1,
      }).returning({ id: schema.knowledge.id });
      
      Logger.debug(`Inserted knowledge: ${knowledge.title}`);
    } catch (error) {
      Logger.error(`Failed to insert knowledge: ${knowledge.title}`, error as Error);
    }
  }
  
  // Rebuild FTS index
  try {
    await db.run(sql`INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')`);
    Logger.info('FTS index rebuilt successfully');
  } catch (error) {
    Logger.warn('Failed to rebuild FTS index', error as Error);
  }
  
  Logger.info(`Seeded ${knowledgeData.length} knowledge entries`);
}

/**
 * Create test participant
 */
async function createTestParticipant(db: DatabaseInstance) {
  Logger.info('Creating test participant...');
  
  try {
    await db.insert(schema.participants).values({
      name: 'Test Kullanıcı',
      email: 'test@example.com',
      phone: '5551234567',
      consentMarketing: 1,
      consentTerms: 1,
    }).onConflictDoNothing();
    
    Logger.info('Test participant created');
  } catch (error) {
    Logger.error('Failed to create test participant', error as Error);
  }
}

/**
 * Update system settings for development
 */
async function updateSystemSettings(db: DatabaseInstance) {
  Logger.info('Updating system settings...');
  
  const devSettings = [
    { key: 'ENVIRONMENT', value: 'development' },
    { key: 'LOG_LEVEL', value: 'debug' },
    { key: 'SEEDED_AT', value: new Date().toISOString() },
    { key: 'SEED_VERSION', value: '1.0.0' },
  ];
  
  for (const setting of devSettings) {
    try {
      await db.insert(schema.systemSettings)
        .values({
          key: setting.key,
          value: setting.value,
          description: `Development setting: ${setting.key}`,
          category: 'development',
          isEnvironmentVariable: 0,
        })
        .onConflictDoUpdate({
          target: schema.systemSettings.key,
          set: {
            value: setting.value,
            updatedAt: dbHelpers.now(),
          },
        });
    } catch (error) {
      Logger.error(`Failed to update setting: ${setting.key}`, error as Error);
    }
  }
  
  Logger.info('System settings updated');
}

/**
 * Verify seeding results
 */
async function verifySeedingResults(db: DatabaseInstance) {
  try {
    // Count questions
    const questionCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.questions);
    
    // Count knowledge entries
    const knowledgeCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.knowledge);
    
    // Count participants
    const participantCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.participants);
    
    Logger.info('Seeding verification:', {
      questions: questionCount[0]?.count || 0,
      knowledge: knowledgeCount[0]?.count || 0,
      participants: participantCount[0]?.count || 0,
    });
    
  } catch (error) {
    Logger.error('Failed to verify seeding results', error as Error);
  }
}

/**
 * Clean existing data before seeding (optional)
 */
async function cleanDatabase(db: DatabaseInstance) {
  Logger.warn('Cleaning existing data...');
  
  try {
    // Delete in reverse order of dependencies
    await db.delete(schema.questionTimings);
    await db.delete(schema.sessionQuestions);
    await db.delete(schema.quizSessions);
    await db.delete(schema.consentRecords);
    await db.delete(schema.dataProcessingActivities);
    await db.delete(schema.auditLogs);
    // Don't delete questions, knowledge, or system settings
    
    Logger.info('Existing data cleaned');
  } catch (error) {
    Logger.error('Failed to clean database', error as Error);
  }
}

// CLI execution
if (import.meta.main) {
  // Simple CLI interface
  const args = process.argv.slice(2);
  const shouldClean = args.includes('--clean');
  const shouldVerify = args.includes('--verify');
  
  // Mock environment for local development
  const mockEnv: Partial<Env> = {
    ENVIRONMENT: 'development',
    LOG_LEVEL: 'debug',
    // Add D1 binding here when running with wrangler
  };
  
  async function run() {
    try {
      if (shouldClean) {
        await cleanDatabase(createDatabaseConnection(mockEnv as Env));
      }
      
      await seedDatabase(mockEnv as Env);
      
      if (shouldVerify) {
        await verifySeedingResults(createDatabaseConnection(mockEnv as Env));
      }
      
      process.exit(0);
    } catch (error) {
      Logger.error('Seeding script failed', error as Error);
      process.exit(1);
    }
  }
  
  run();
}

// Export for use in other scripts
export { seedDatabase, cleanDatabase, verifySeedingResults };
