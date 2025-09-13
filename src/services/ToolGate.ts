/**
 * Tool Gate - Faz Bazlı Tool Çağrısı Kontrolü
 * Yarışma akışında sadece uygun fazda uygun tool'ların çağrılmasını sağlar
 */

export type QuizPhase = 'greeting' | 'asking' | 'listening' | 'post-score';

export interface ToolGateResult {
  allowed: boolean;
  reason?: string;
  newPhase?: QuizPhase;
}

export class ToolGate {
  private static phaseToolMap: Record<QuizPhase, string[]> = {
    greeting: ['quiz_startSession', 'quiz_nextQuestion'],
    asking: [], // Sadece soru okunur, tool çağrısı yok
    listening: ['quiz_reportIntent', 'quiz_submitAnswer', 'quiz_infoLookup'],
    'post-score': ['quiz_nextQuestion', 'quiz_finishSession', 'quiz_getLeaderboard']
  };

  private static phaseTransitions: Record<string, QuizPhase> = {
    'quiz_startSession': 'asking',
    'quiz_nextQuestion': 'asking',
    'quiz_submitAnswer': 'post-score',
    'quiz_infoLookup': 'post-score',
    'quiz_finishSession': 'greeting'
  };

  /**
   * Check if tool call is allowed in current phase
   */
  static checkToolCall(
    currentPhase: QuizPhase, 
    toolName: string
  ): ToolGateResult {
    const allowedTools = this.phaseToolMap[currentPhase];
    
    if (!allowedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' not allowed in phase '${currentPhase}'. Allowed: [${allowedTools.join(', ')}]`
      };
    }

    // Check for phase transition
    const newPhase = this.phaseTransitions[toolName];
    
    return {
      allowed: true,
      newPhase: newPhase || currentPhase
    };
  }

  /**
   * Get allowed tools for current phase
   */
  static getAllowedTools(phase: QuizPhase): string[] {
    return this.phaseToolMap[phase] || [];
  }

  /**
   * Get next phase after tool execution
   */
  static getNextPhase(toolName: string, currentPhase: QuizPhase): QuizPhase {
    return this.phaseTransitions[toolName] || currentPhase;
  }

  /**
   * Validate phase transition
   */
  static isValidTransition(from: QuizPhase, to: QuizPhase): boolean {
    const validTransitions: Record<QuizPhase, QuizPhase[]> = {
      greeting: ['asking'],
      asking: ['listening'],
      listening: ['post-score'],
      'post-score': ['asking', 'greeting'] // next question or finish
    };

    return validTransitions[from]?.includes(to) || false;
  }
}
