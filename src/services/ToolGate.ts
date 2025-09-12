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
    greeting: ['quiz.startSession', 'quiz.nextQuestion'],
    asking: [], // Sadece soru okunur, tool çağrısı yok
    listening: ['quiz.reportIntent', 'quiz.submitAnswer', 'quiz.infoLookup'],
    'post-score': ['quiz.nextQuestion', 'quiz.finishSession', 'quiz.getLeaderboard']
  };

  private static phaseTransitions: Record<string, QuizPhase> = {
    'quiz.startSession': 'asking',
    'quiz.nextQuestion': 'asking',
    'quiz.submitAnswer': 'post-score',
    'quiz.infoLookup': 'post-score',
    'quiz.finishSession': 'greeting'
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
