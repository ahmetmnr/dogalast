/**
 * Quiz Domain Type Definitions
 * Core types for the quiz functionality
 */

/**
 * Quiz session states
 */
export type QuizStatus = 'active' | 'completed' | 'paused' | 'abandoned';

/**
 * Question difficulty levels (1-5)
 */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Timing event types for server-authoritative timing
 * Based on UML diagram specifications
 */
export type TimingEventType = 
  | 'tts_start'        // Text-to-speech started
  | 'tts_end'          // Text-to-speech ended
  | 'speech_start'     // User started speaking
  | 'answer_received'; // ASR final transcript received

/**
 * Quiz session interface
 */
export interface QuizSession {
  /** Unique session ID (UUID) */
  id: string;
  
  /** Participant ID reference */
  participantId: number;
  
  /** Current session status */
  status: QuizStatus;
  
  /** Total accumulated score */
  totalScore: number;
  
  /** Current question index (0-based) */
  currentQuestionIndex: number;
  
  /** Session start timestamp */
  startedAt: Date;
  
  /** Session completion timestamp */
  completedAt?: Date;
  
  /** Last activity timestamp (for deterministic ranking) */
  lastActivityAt: Date;
}

/**
 * Question interface
 */
export interface Question {
  /** Unique question ID (UUID) */
  id: string;
  
  /** Display order number */
  orderNo: number;
  
  /** Question text */
  text: string;
  
  /** Correct answer text */
  correctAnswer: string;
  
  /** Optional multiple choice options */
  options?: string[];
  
  /** Difficulty level (1-5) */
  difficulty: DifficultyLevel;
  
  /** Base points for correct answer */
  basePoints: number;
  
  /** Time limit in seconds */
  timeLimit: number;
  
  /** Question category */
  category: string;
  
  /** Whether question is active */
  isActive: boolean;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Session question - links a question to a session
 */
export interface SessionQuestion {
  /** Unique ID (UUID) */
  id: string;
  
  /** Session ID reference */
  sessionId: string;
  
  /** Question ID reference */
  questionId: string;
  
  /** Order in this session */
  orderInSession: number;
  
  /** Whether answered */
  isAnswered: boolean;
  
  /** User's answer */
  userAnswer?: string;
  
  /** Whether answer was correct */
  isCorrect?: boolean;
  
  /** Points earned */
  pointsEarned: number;
  
  /** Time taken to answer (milliseconds) */
  responseTime?: number;
  
  /** When question was presented */
  presentedAt: Date;
  
  /** When answer was received */
  answeredAt?: Date;
}

/**
 * Timing breakdown for scoring calculation
 */
export interface TimingBreakdown {
  /** TTS start timestamp */
  ttsStart?: Date;
  
  /** TTS end timestamp */
  ttsEnd?: Date;
  
  /** Speech start timestamp */
  speechStart?: Date;
  
  /** Answer received timestamp */
  answerReceived?: Date;
  
  /** Calculated timer start (earliest of TTS end or speech start) */
  timerStart?: Date;
  
  /** Total response time in milliseconds */
  totalResponseTime?: number;
  
  /** Network latency if measured */
  networkLatency?: number;
}

/**
 * Score calculation result
 */
export interface ScoreResult {
  /** Base points from question */
  basePoints: number;
  
  /** Time bonus points */
  timeBonus: number;
  
  /** Difficulty multiplier */
  difficultyMultiplier: number;
  
  /** Total points earned */
  totalPoints: number;
  
  /** Calculation breakdown for transparency */
  breakdown: {
    responseTimeMs: number;
    timeLimitMs: number;
    bonusPercentage: number;
  };
}

/**
 * Quiz start request
 */
export interface QuizStartRequest {
  /** Participant JWT token */
  token: string;
  
  /** Optional session ID to resume */
  sessionId?: string;
}

/**
 * Quiz start response
 */
export interface QuizStartResponse {
  /** Session ID */
  sessionId: string;
  
  /** First question (if not resuming) */
  firstQuestion?: QuestionPresentation;
  
  /** Current state (if resuming) */
  currentState?: {
    questionIndex: number;
    totalScore: number;
    remainingQuestions: number;
  };
}

/**
 * Question presentation format
 */
export interface QuestionPresentation {
  /** Question ID */
  questionId: string;
  
  /** Question number (1-based for display) */
  questionNumber: number;
  
  /** Total questions in quiz */
  totalQuestions: number;
  
  /** Question text */
  text: string;
  
  /** Optional choices */
  options?: string[];
  
  /** Time limit in seconds */
  timeLimit: number;
  
  /** Category for display */
  category: string;
  
  /** Server timestamp when presented */
  presentedAt: string;
}

/**
 * Answer submission request
 */
export interface AnswerSubmitRequest {
  /** Session ID */
  sessionId: string;
  
  /** Question ID */
  questionId: string;
  
  /** User's answer */
  answer: string;
  
  /** Client timestamp (for latency calculation) */
  clientTimestamp?: string;
}

/**
 * Answer submission response
 */
export interface AnswerSubmitResponse {
  /** Whether answer was correct */
  isCorrect: boolean;
  
  /** Correct answer (for learning) */
  correctAnswer: string;
  
  /** Points earned */
  pointsEarned: number;
  
  /** Score breakdown */
  scoreBreakdown: ScoreResult;
  
  /** Current total score */
  totalScore: number;
  
  /** Next question (if available) */
  nextQuestion?: QuestionPresentation;
  
  /** Quiz complete flag */
  isQuizComplete: boolean;
}

/**
 * Quiz completion result
 */
export interface QuizCompletionResult {
  /** Final score */
  finalScore: number;
  
  /** Final rank */
  rank: number;
  
  /** Total participants */
  totalParticipants: number;
  
  /** Performance statistics */
  stats: {
    totalQuestions: number;
    correctAnswers: number;
    accuracy: number;
    avgResponseTime: number;
    fastestResponse: number;
    slowestResponse: number;
  };
  
  /** Achievement badges (if any) */
  achievements?: Achievement[];
}

/**
 * Achievement/Badge system
 */
export interface Achievement {
  /** Achievement ID */
  id: string;
  
  /** Achievement name */
  name: string;
  
  /** Achievement description */
  description: string;
  
  /** Icon identifier */
  icon: string;
  
  /** When earned */
  earnedAt: Date;
}

/**
 * Real-time quiz event for WebSocket
 */
export interface QuizEvent {
  /** Event type */
  type: 'question' | 'answer' | 'score_update' | 'quiz_end' | 'timeout';
  
  /** Event payload */
  payload: any;
  
  /** Server timestamp */
  timestamp: string;
  
  /** Session ID */
  sessionId: string;
}

/**
 * Voice interaction state
 */
export interface VoiceState {
  /** Whether TTS is currently playing */
  isTTSPlaying: boolean;
  
  /** Whether user is currently speaking */
  isUserSpeaking: boolean;
  
  /** Whether waiting for user input */
  isListening: boolean;
  
  /** Current VAD threshold */
  vadThreshold: number;
  
  /** Calibration status */
  isCalibrated: boolean;
}

/**
 * Quiz configuration
 */
export interface QuizConfig {
  /** Maximum questions per session */
  maxQuestions: number;
  
  /** Session timeout in seconds */
  sessionTimeout: number;
  
  /** Whether to randomize question order */
  randomizeQuestions: boolean;
  
  /** Whether to show correct answers */
  showCorrectAnswers: boolean;
  
  /** Minimum time between questions (seconds) */
  questionInterval: number;
  
  /** Enable voice feedback */
  enableVoiceFeedback: boolean;
}
