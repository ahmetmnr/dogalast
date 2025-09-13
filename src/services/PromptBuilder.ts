/**
 * Prompt Builder - Realtime prompts'ları birleştirip OpenAI'ya gönderir
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export class PromptBuilder {
  private static promptsDir = join(process.cwd(), 'src/realtime/prompts');

  /**
   * Build complete system instructions from prompt files
   */
  static buildSystemInstructions(): string {
    try {
      const basePrompt = readFileSync(join(this.promptsDir, 'system.base.md'), 'utf-8');
      const flowPrompt = readFileSync(join(this.promptsDir, 'system.flow.md'), 'utf-8');
      const fairnessPrompt = readFileSync(join(this.promptsDir, 'system.fairness.md'), 'utf-8');
      const audioPrompt = readFileSync(join(this.promptsDir, 'system.audio.md'), 'utf-8');

      return `${basePrompt}

${flowPrompt}

${fairnessPrompt}

${audioPrompt}

## ÖZET KURALLAR:
1. Soruları net Türkçe ile oku
2. Sadece tool'larla durum değiştir  
3. Barge-in'de hemen sus
4. İpucu için: "Adil yarış için finalde konuşalım"
5. Kısa cümleler kullan
6. Faz kurallarına uy`;

    } catch (error) {
      console.error('Failed to read prompt files:', error);
      return 'Sen bir sıfır atık yarışması asistanısın. Soruları oku, cevapları değerlendir.';
    }
  }

  /**
   * Get tools schema from file
   */
  static getToolsSchema(): any[] {
    // Return tools array for OpenAI
    return [
      {
        type: "function",
        name: "quiz_nextQuestion",
        description: "Sıradaki soruya geç ve oku",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string" }
          },
          required: ["sessionId"]
        }
      },
      {
        type: "function",
        name: "quiz_submitAnswer", 
        description: "Kullanıcının cevabını değerlendir ve puan ver",
        parameters: {
          type: "object",
          properties: {
            sessionQuestionId: { type: "string" },
            answerText: { type: "string" },
            answeredAt: { type: "string" }
          },
          required: ["sessionQuestionId", "answerText", "answeredAt"]
        }
      },
      {
        type: "function",
        name: "quiz_markTtsEnd",
        description: "TTS bittiğini işaretle",
        parameters: {
          type: "object", 
          properties: {
            sessionQuestionId: { type: "string" },
            ttsEndedAt: { type: "string" }
          },
          required: ["sessionQuestionId", "ttsEndedAt"]
        }
      }
    ];
  }
}

