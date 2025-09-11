/**
 * Knowledge Service
 * Full-text search and intent classification for quiz knowledge base
 */

import { eq, sql, like, and, or } from 'drizzle-orm';
import { knowledge, auditLogs } from '@/db/schema';
import { Logger } from '@/utils/logger';
import type { DatabaseInstance } from '@/db/connection';

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  difficulty: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface SearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  relevanceScore: number;
  snippet: string;
}

interface IntentClassification {
  intent: 'question' | 'definition' | 'example' | 'process' | 'benefit' | 'challenge';
  confidence: number;
  keywords: string[];
  suggestedResponse: string;
}

interface KnowledgeQuery {
  query: string;
  category?: string;
  difficulty?: number;
  limit?: number;
  offset?: number;
}

export class KnowledgeService {
  private db: DatabaseInstance;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /**
   * Setup FTS5 virtual table for full-text search
   */
  async setupFTS5Index(): Promise<void> {
    try {
      // Create FTS5 virtual table
      await this.db.run(sql`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
          id UNINDEXED,
          title,
          content,
          keywords,
          category UNINDEXED,
          content='knowledge',
          content_rowid='id'
        );
      `);

      // Create triggers to keep FTS in sync
      await this.db.run(sql`
        CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge BEGIN
          INSERT INTO knowledge_fts(id, title, content, keywords, category) 
          VALUES (new.id, new.title, new.content, new.keywords, new.category);
        END;
      `);

      await this.db.run(sql`
        CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge BEGIN
          DELETE FROM knowledge_fts WHERE id = old.id;
        END;
      `);

      await this.db.run(sql`
        CREATE TRIGGER IF NOT EXISTS knowledge_fts_update AFTER UPDATE ON knowledge BEGIN
          DELETE FROM knowledge_fts WHERE id = old.id;
          INSERT INTO knowledge_fts(id, title, content, keywords, category) 
          VALUES (new.id, new.title, new.content, new.keywords, new.category);
        END;
      `);

      Logger.info('FTS5 index setup completed');

    } catch (error) {
      Logger.error('Failed to setup FTS5 index', error as Error);
      throw new Error('Knowledge search index setup failed');
    }
  }

  /**
   * Search knowledge base with full-text search
   */
  async searchKnowledge(query: KnowledgeQuery): Promise<SearchResult[]> {
    try {
      const { query: searchQuery, category, difficulty, limit = 10, offset = 0 } = query;
      
      // Normalize search query
      const normalizedQuery = this.normalizeSearchQuery(searchQuery);
      
      if (!normalizedQuery) {
        return [];
      }

      // Build FTS5 query
      const ftsQuery = this.buildFTS5Query(normalizedQuery);
      
      // Execute search with filters
      const results = await this.db
        .select({
          id: knowledge.id,
          title: knowledge.title,
          content: knowledge.content,
          category: knowledge.category,
          keywords: knowledge.keywords,
          difficulty: knowledge.difficulty,
          rank: sql<number>`bm25(knowledge_fts)`.as('rank')
        })
        .from(knowledge)
        .innerJoin(sql`knowledge_fts`, sql`knowledge.id = knowledge_fts.id`)
        .where(
          and(
            sql`knowledge_fts MATCH ${ftsQuery}`,
            eq(knowledge.isActive, true),
            category ? eq(knowledge.category, category) : undefined,
            difficulty ? eq(knowledge.difficulty, difficulty) : undefined
          )
        )
        .orderBy(sql`rank`)
        .limit(limit)
        .offset(offset);

      // Process results and generate snippets
      const searchResults: SearchResult[] = results.map(result => ({
        id: result.id,
        title: result.title,
        content: result.content,
        category: result.category,
        relevanceScore: Math.max(0, 1 - (result.rank || 0) / 10), // Convert BM25 to 0-1 score
        snippet: this.generateSnippet(result.content, normalizedQuery)
      }));

      Logger.info('Knowledge search completed', {
        query: searchQuery,
        resultsCount: searchResults.length,
        category,
        difficulty
      });

      return searchResults;

    } catch (error) {
      Logger.error('Knowledge search failed', error as Error, { query });
      throw new Error('Knowledge search failed');
    }
  }

  /**
   * Classify user intent from query
   */
  classifyIntent(query: string): IntentClassification {
    const normalizedQuery = query.toLowerCase().trim();
    const keywords = normalizedQuery.split(/\s+/);

    // Intent patterns
    const intentPatterns = {
      question: /^(ne|nedir|nasıl|neden|kim|hangi|kaç|kadar|ne zaman)/i,
      definition: /^(tanımla|açıkla|anlat|tarif et|nedir)/i,
      example: /^(örnek|mesela|sample|misal)/i,
      process: /^(nasıl yapılır|adımlar|süreç|işlem)/i,
      benefit: /^(fayda|yarar|avantaj|kazanç)/i,
      challenge: /^(zorluk|problem|engel|dezavantaj)/i
    };

    let bestMatch: { intent: keyof typeof intentPatterns; confidence: number } = {
      intent: 'definition',
      confidence: 0.5
    };

    // Check patterns
    for (const [intent, pattern] of Object.entries(intentPatterns)) {
      if (pattern.test(normalizedQuery)) {
        bestMatch = {
          intent: intent as keyof typeof intentPatterns,
          confidence: 0.9
        };
        break;
      }
    }

    // Generate suggested response based on intent
    const suggestedResponse = this.generateSuggestedResponse(bestMatch.intent, keywords);

    return {
      intent: bestMatch.intent,
      confidence: bestMatch.confidence,
      keywords,
      suggestedResponse
    };
  }

  /**
   * Handle info query from user
   */
  async handleInfoQuery(query: string, sessionId?: string): Promise<{
    results: SearchResult[];
    intent: IntentClassification;
    responseText: string;
  }> {
    try {
      // Classify intent
      const intent = this.classifyIntent(query);
      
      // Search knowledge base
      const results = await this.searchKnowledge({
        query,
        limit: 3 // Top 3 most relevant results
      });

      // Generate response text
      let responseText = '';
      
      if (results.length > 0) {
        const topResult = results[0];
        responseText = this.generateResponseText(intent, topResult, query);
      } else {
        responseText = this.generateNoResultsResponse(intent, query);
      }

      // Log the query for analytics
      await this.logInfoQuery(query, intent, results.length, sessionId);

      return {
        results,
        intent,
        responseText
      };

    } catch (error) {
      Logger.error('Info query handling failed', error as Error, { query });
      
      return {
        results: [],
        intent: {
          intent: 'question',
          confidence: 0.5,
          keywords: [],
          suggestedResponse: 'Üzgünüm, şu anda bu bilgiyi bulamıyorum.'
        },
        responseText: 'Üzgünüm, bilgi arama sırasında bir hata oluştu. Lütfen sorunuzu farklı kelimelerle tekrar sorar mısınız?'
      };
    }
  }

  /**
   * Add new knowledge entry
   */
  async addKnowledgeEntry(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const entryId = crypto.randomUUID();
      
      await this.db.insert(knowledge).values({
        id: entryId,
        title: entry.title,
        content: entry.content,
        category: entry.category,
        keywords: JSON.stringify(entry.keywords),
        difficulty: entry.difficulty,
        isActive: entry.isActive
      });

      Logger.info('Knowledge entry added', { entryId, title: entry.title });
      
      return entryId;

    } catch (error) {
      Logger.error('Failed to add knowledge entry', error as Error);
      throw new Error('Knowledge entry creation failed');
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Normalize search query
   */
  private normalizeSearchQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      // Turkish character normalization
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      // Remove extra spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build FTS5 query string
   */
  private buildFTS5Query(normalizedQuery: string): string {
    const words = normalizedQuery.split(/\s+/).filter(word => word.length > 2);
    
    if (words.length === 0) {
      return normalizedQuery;
    }

    // Use phrase search for exact matches, OR for individual words
    const phraseQuery = `"${normalizedQuery}"`;
    const wordQueries = words.map(word => `${word}*`).join(' OR ');
    
    return `(${phraseQuery}) OR (${wordQueries})`;
  }

  /**
   * Generate snippet from content
   */
  private generateSnippet(content: string, query: string, maxLength: number = 150): string {
    const normalizedContent = content.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    
    // Find the position of the query in content
    const queryIndex = normalizedContent.indexOf(normalizedQuery);
    
    if (queryIndex === -1) {
      // Query not found, return beginning of content
      return content.length > maxLength 
        ? `${content.substring(0, maxLength)}...`
        : content;
    }

    // Calculate snippet start position
    const snippetStart = Math.max(0, queryIndex - 50);
    const snippetEnd = Math.min(content.length, snippetStart + maxLength);
    
    let snippet = content.substring(snippetStart, snippetEnd);
    
    // Add ellipsis if truncated
    if (snippetStart > 0) snippet = `...${snippet}`;
    if (snippetEnd < content.length) snippet = `${snippet}...`;
    
    return snippet;
  }

  /**
   * Generate suggested response based on intent
   */
  private generateSuggestedResponse(intent: string, keywords: string[]): string {
    const responses = {
      question: 'Bu konuda size yardımcı olabilirim. Hangi spesifik bilgiyi merak ediyorsunuz?',
      definition: 'Bu terimin tanımını açıklayabilirim.',
      example: 'Bu konuda örnekler verebilirim.',
      process: 'Bu sürecin adımlarını açıklayabilirim.',
      benefit: 'Bu konunun faydalarını anlatabilirim.',
      challenge: 'Bu konudaki zorlukları açıklayabilirim.'
    };

    return responses[intent as keyof typeof responses] || responses.question;
  }

  /**
   * Generate response text based on search results
   */
  private generateResponseText(intent: IntentClassification, result: SearchResult, originalQuery: string): string {
    const { intent: intentType, confidence } = intent;
    
    let responseText = '';

    // High confidence responses
    if (confidence > 0.8) {
      switch (intentType) {
        case 'definition':
          responseText = `${result.title} hakkında: ${result.snippet}`;
          break;
        case 'question':
          responseText = `Bu sorunuzla ilgili bilgi: ${result.snippet}`;
          break;
        case 'example':
          responseText = `${result.title} için örnek: ${result.snippet}`;
          break;
        case 'process':
          responseText = `${result.title} süreci: ${result.snippet}`;
          break;
        case 'benefit':
          responseText = `${result.title} faydaları: ${result.snippet}`;
          break;
        case 'challenge':
          responseText = `${result.title} zorlukları: ${result.snippet}`;
          break;
        default:
          responseText = `${result.title}: ${result.snippet}`;
      }
    } else {
      // Lower confidence, more generic response
      responseText = `"${originalQuery}" ile ilgili bulduğum bilgi: ${result.snippet}`;
    }

    return responseText;
  }

  /**
   * Generate no results response
   */
  private generateNoResultsResponse(intent: IntentClassification, query: string): string {
    const responses = [
      `"${query}" hakkında bilgi bulamadım. Sorunuzu farklı kelimelerle sorar mısınız?`,
      `Bu konuda elimde yeterli bilgi yok. Daha spesifik bir soru sorabilir misiniz?`,
      `Üzgünüm, bu konu hakkında detaylı bilgim bulunmuyor. Başka bir soru sormak ister misiniz?`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Log info query for analytics
   */
  private async logInfoQuery(
    query: string, 
    intent: IntentClassification, 
    resultsCount: number, 
    sessionId?: string
  ): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        tableName: 'knowledge_queries',
        recordId: crypto.randomUUID(),
        action: 'SELECT',
        newValues: JSON.stringify({
          query,
          intent: intent.intent,
          confidence: intent.confidence,
          resultsCount,
          sessionId,
          timestamp: new Date().toISOString()
        }),
        privacyImpact: 'search_analytics'
      });

    } catch (error) {
      Logger.error('Failed to log info query', error as Error);
      // Don't throw - logging failure shouldn't break search
    }
  }
}
