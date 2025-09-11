/**
 * Quiz Interface Component
 * Integrates audio, realtime, and quiz functionality
 */

import { AudioManager, AudioUtils, type AudioEvent } from '../core/AudioManager';
import { RealtimeClient, type RealtimeConfig, type ConnectionState } from '../core/RealtimeClient';
import { WebSocketEventHelper } from '../core/WebSocketManager';
import { api, apiClient } from '../core/ApiClient';

// ============================================================================
// Types
// ============================================================================

interface QuizState {
  sessionId: string | null;
  currentQuestion: any | null;
  totalScore: number;
  questionIndex: number;
  isActive: boolean;
  isWaitingForAnswer: boolean;
  currentSessionQuestionId: string | null;
}

interface QuizConfig {
  containerId: string;
  onQuizComplete?: (results: any) => void;
  onError?: (error: any) => void;
  onStateChange?: (state: QuizState) => void;
}

// ============================================================================
// Quiz Interface Class
// ============================================================================

export class QuizInterface {
  private container: HTMLElement;
  private config: QuizConfig;
  private audioManager: AudioManager;
  private realtimeClient: RealtimeClient | null = null;
  private quizState: QuizState;
  private isInitialized = false;
  private cleanupFunctions: (() => void)[] = [];

  constructor(config: QuizConfig) {
    this.config = config;
    
    const container = document.getElementById(config.containerId);
    if (!container) {
      throw new Error(`Container element not found: ${config.containerId}`);
    }
    this.container = container;

    // Initialize quiz state
    this.quizState = {
      sessionId: null,
      currentQuestion: null,
      totalScore: 0,
      questionIndex: 0,
      isActive: false,
      isWaitingForAnswer: false,
      currentSessionQuestionId: null,
    };

    // Initialize audio manager
    this.audioManager = new AudioManager({
      sampleRate: 24000,
      vadThreshold: 0.02,
    });
  }

  /**
   * Initialize the quiz interface
   */
  async initialize(): Promise<void> {
    try {
      // Check browser support
      const browserSupport = AudioUtils.checkBrowserSupport();
      if (!browserSupport.supported) {
        throw new Error(`Browser not supported. Missing: ${browserSupport.missing.join(', ')}`);
      }

      // Check authentication
      if (!apiClient.isAuthenticated()) {
        throw new Error('User must be authenticated to start quiz');
      }

      // Initialize audio system
      await this.audioManager.initialize();
      
      // Setup audio event listeners
      this.setupAudioEventListeners();

      // Setup WebSocket for real-time updates
      this.setupWebSocketListeners();

      // Render initial UI
      this.renderUI();

      this.isInitialized = true;
      console.log('Quiz interface initialized successfully');

    } catch (error) {
      console.error('Quiz interface initialization failed:', error);
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Start a new quiz session
   */
  async startQuiz(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Quiz interface not initialized');
    }

    try {
      this.showLoading('Yarışma başlatılıyor...');

      // Start quiz via API
      const response = await api.tools.startQuiz();

      if (response.success && response.data) {
        this.quizState.sessionId = response.data.sessionId;
        this.quizState.currentQuestion = response.data.currentQuestion;
        this.quizState.totalScore = response.data.totalScore;
        this.quizState.questionIndex = response.data.questionIndex;
        this.quizState.isActive = true;
        this.quizState.currentSessionQuestionId = response.data.currentQuestion?.sessionQuestionId;

        // Initialize OpenAI Realtime connection
        await this.initializeRealtimeConnection();

        // Start audio recording
        await this.audioManager.startRecording();

        // Calibrate VAD
        await this.calibrateAudio();

        // Present first question
        await this.presentCurrentQuestion();

        this.updateUI();
        this.notifyStateChange();

        console.log('Quiz started successfully:', this.quizState.sessionId);

      } else {
        throw new Error(response.error?.message || 'Quiz start failed');
      }

    } catch (error) {
      console.error('Failed to start quiz:', error);
      this.handleError(error);
      throw error;
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Submit an answer for the current question
   */
  async submitAnswer(answer: string, confidence: number): Promise<void> {
    if (!this.quizState.isActive || !this.quizState.currentSessionQuestionId) {
      throw new Error('No active question to answer');
    }

    try {
      this.quizState.isWaitingForAnswer = true;
      this.updateUI();

      // Submit answer via API
      const response = await api.tools.submitAnswer(
        this.quizState.currentSessionQuestionId,
        answer,
        confidence,
        Date.now()
      );

      if (response.success && response.data) {
        const result = response.data;

        // Update score
        this.quizState.totalScore += result.earnedPoints;

        // Show answer feedback
        this.showAnswerFeedback(result);

        // Wait for feedback display
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Move to next question or finish quiz
        await this.proceedToNextQuestion();

      } else {
        throw new Error(response.error?.message || 'Answer submission failed');
      }

    } catch (error) {
      console.error('Failed to submit answer:', error);
      this.handleError(error);
    } finally {
      this.quizState.isWaitingForAnswer = false;
      this.updateUI();
    }
  }

  /**
   * Finish the current quiz session
   */
  async finishQuiz(): Promise<void> {
    if (!this.quizState.sessionId) {
      return;
    }

    try {
      this.showLoading('Yarışma sonuçlandırılıyor...');

      // Finish quiz via API
      const response = await api.tools.finishQuiz(this.quizState.sessionId);

      if (response.success && response.data) {
        const results = response.data;

        // Update state
        this.quizState.isActive = false;

        // Cleanup audio and realtime connections
        await this.cleanup();

        // Show results
        this.showQuizResults(results);

        // Notify completion
        if (this.config.onQuizComplete) {
          this.config.onQuizComplete(results);
        }

        console.log('Quiz finished successfully');

      } else {
        throw new Error(response.error?.message || 'Quiz finish failed');
      }

    } catch (error) {
      console.error('Failed to finish quiz:', error);
      this.handleError(error);
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      // Stop audio recording
      await this.audioManager.stopRecording();

      // Disconnect realtime client
      if (this.realtimeClient) {
        await this.realtimeClient.disconnect();
        this.realtimeClient = null;
      }

      // Cleanup audio manager
      await this.audioManager.cleanup();

      // Run cleanup functions
      this.cleanupFunctions.forEach(cleanup => cleanup());
      this.cleanupFunctions = [];

      console.log('Quiz interface cleaned up');

    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Initialize OpenAI Realtime connection
   */
  private async initializeRealtimeConnection(): Promise<void> {
    if (!this.quizState.sessionId) {
      throw new Error('Session ID required for realtime connection');
    }

    const realtimeConfig: RealtimeConfig = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'alloy',
      sessionId: this.quizState.sessionId,
      onAudioReceived: (audioData: ArrayBuffer) => {
        this.handleRealtimeAudio(audioData);
      },
      onTranscriptReceived: (transcript: string, isFinal: boolean) => {
        this.handleRealtimeTranscript(transcript, isFinal);
      },
      onConnectionStateChange: (state: ConnectionState) => {
        this.handleRealtimeConnectionChange(state);
      },
      onError: (error: any) => {
        this.handleRealtimeError(error);
      }
    };

    this.realtimeClient = new RealtimeClient(realtimeConfig);
    await this.realtimeClient.connect();
  }

  /**
   * Setup audio event listeners
   */
  private setupAudioEventListeners(): void {
    // Speech start detection
    this.audioManager.addEventListener('speechStart', (event: AudioEvent) => {
      console.log('Speech started detected');
      
      // Mark speech start via API
      if (this.quizState.currentSessionQuestionId) {
        api.tools.markSpeechStart(
          this.quizState.currentSessionQuestionId,
          this.audioManager.getVADThreshold(),
          event.timestamp
        ).catch(error => {
          console.error('Failed to mark speech start:', error);
        });
      }
    });

    // Speech end detection
    this.audioManager.addEventListener('speechEnd', () => {
      console.log('Speech ended detected');
      
      // Commit audio to OpenAI for processing
      if (this.realtimeClient) {
        this.realtimeClient.commitAudio().catch(error => {
          console.error('Failed to commit audio:', error);
        });
      }
    });

    // Audio data streaming
    this.audioManager.addEventListener('audioData', (event: AudioEvent) => {
      // Send audio to OpenAI Realtime API
      if (this.realtimeClient && event.data.isSpeaking) {
        this.realtimeClient.sendAudio(event.data.audioData).catch(error => {
          console.error('Failed to send audio to OpenAI:', error);
        });
      }
    });

    // VAD calibration completion
    this.audioManager.addEventListener('calibrationComplete', (event: AudioEvent) => {
      console.log('VAD calibration completed:', event.data);
      this.showCalibrationResult(event.data);
    });

    // Audio errors
    this.audioManager.addEventListener('error', (event: AudioEvent) => {
      console.error('Audio error:', event.data);
      this.handleError(event.data);
    });
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupWebSocketListeners(): void {
    // Real-time leaderboard updates
    const leaderboardCleanup = WebSocketEventHelper.setupLeaderboardUpdates(
      (leaderboard) => {
        this.updateLeaderboardDisplay(leaderboard);
      },
      (error) => {
        console.error('Leaderboard update error:', error);
      }
    );
    this.cleanupFunctions.push(leaderboardCleanup);

    // Quiz event updates
    const quizEventsCleanup = WebSocketEventHelper.setupQuizEvents(
      (event) => {
        this.handleQuizEvent(event);
      },
      this.quizState.sessionId || undefined
    );
    this.cleanupFunctions.push(quizEventsCleanup);

    // Connection monitoring
    const connectionCleanup = WebSocketEventHelper.setupConnectionMonitoring(
      (state) => {
        this.updateConnectionStatus(state);
      }
    );
    this.cleanupFunctions.push(connectionCleanup);
  }

  /**
   * Calibrate audio system
   */
  private async calibrateAudio(): Promise<void> {
    try {
      this.showStatus('Ses sistemi kalibre ediliyor... Lütfen sessizce bekleyin.');

      const calibrationResult = await this.audioManager.calibrateVAD(3000);

      if (calibrationResult.calibrationQuality === 'poor') {
        this.showWarning('Ses kalitesi düşük. Gürültülü bir ortamda olabilirsiniz.');
      }

    } catch (error) {
      console.error('Audio calibration failed:', error);
      this.showWarning('Ses kalibrasyonu başarısız. Varsayılan ayarlar kullanılacak.');
    }
  }

  /**
   * Present the current question via TTS
   */
  private async presentCurrentQuestion(): Promise<void> {
    if (!this.quizState.currentQuestion || !this.realtimeClient) {
      return;
    }

    try {
      const question = this.quizState.currentQuestion;
      
      // Mark TTS start
      if (question.sessionQuestionId) {
        await api.tools.markTTSEnd(question.sessionQuestionId, Date.now());
      }

      // Send question to OpenAI for TTS
      const questionText = `Soru ${this.quizState.questionIndex + 1}: ${question.text}`;
      await this.realtimeClient.sendTextMessage(questionText);

      console.log('Question presented via TTS:', questionText);

    } catch (error) {
      console.error('Failed to present question:', error);
      this.handleError(error);
    }
  }

  /**
   * Proceed to next question or finish quiz
   */
  private async proceedToNextQuestion(): Promise<void> {
    try {
      if (!this.quizState.sessionId) {
        return;
      }

      // Get next question
      const response = await api.tools.nextQuestion(this.quizState.sessionId);

      if (response.success && response.data) {
        // Update state with new question
        this.quizState.currentQuestion = response.data.currentQuestion;
        this.quizState.questionIndex = response.data.questionIndex;
        this.quizState.currentSessionQuestionId = response.data.currentQuestion?.sessionQuestionId;

        // Present new question
        await this.presentCurrentQuestion();

        this.updateUI();
        this.notifyStateChange();

      } else {
        // No more questions, finish quiz
        await this.finishQuiz();
      }

    } catch (error) {
      console.error('Failed to proceed to next question:', error);
      
      // If it's "all questions completed" error, finish quiz
      if (error instanceof Error && error.message === 'ALL_QUESTIONS_COMPLETED') {
        await this.finishQuiz();
      } else {
        this.handleError(error);
      }
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle realtime audio from OpenAI
   */
  private async handleRealtimeAudio(audioData: ArrayBuffer): Promise<void> {
    try {
      // Play audio response
      const audioContext = this.audioManager.getAudioContext();
      if (audioContext) {
        await AudioUtils.playAudio(audioContext, audioData, 24000);
      }
    } catch (error) {
      console.error('Failed to play realtime audio:', error);
    }
  }

  /**
   * Handle realtime transcript from OpenAI
   */
  private handleRealtimeTranscript(transcript: string, isFinal: boolean): void {
    console.log('Realtime transcript:', transcript, 'Final:', isFinal);

    if (isFinal && transcript.trim()) {
      // Submit the transcript as an answer
      this.submitAnswer(transcript.trim(), 0.9).catch(error => {
        console.error('Failed to submit transcript answer:', error);
      });
    }
  }

  /**
   * Handle realtime connection state changes
   */
  private handleRealtimeConnectionChange(state: ConnectionState): void {
    console.log('Realtime connection state:', state);
    this.updateConnectionStatus(state);
  }

  /**
   * Handle realtime errors
   */
  private handleRealtimeError(error: any): void {
    console.error('Realtime error:', error);
    this.handleError(error);
  }

  /**
   * Handle quiz events from WebSocket
   */
  private handleQuizEvent(event: any): void {
    console.log('Quiz event received:', event);
    // Handle real-time quiz events (e.g., session updates)
  }

  /**
   * Handle errors
   */
  private handleError(error: any): void {
    console.error('Quiz interface error:', error);

    let errorMessage = 'Bir hata oluştu';
    
    if (error && typeof error === 'object') {
      errorMessage = error.message || error.toString();
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    this.showError(errorMessage);

    if (this.config.onError) {
      this.config.onError(error);
    }
  }

  // ============================================================================
  // UI Methods
  // ============================================================================

  /**
   * Render the quiz interface UI
   */
  private renderUI(): void {
    this.container.innerHTML = `
      <div class="quiz-interface">
        <!-- Connection Status -->
        <div class="connection-status" id="connection-status">
          <div class="status-indicator" id="status-indicator"></div>
          <span class="status-text" id="status-text">Bağlantı durumu</span>
        </div>

        <!-- Score Display -->
        <div class="score-display" id="score-display">
          <span class="score-label">Puan:</span>
          <span class="score-value" id="score-value">0</span>
        </div>

        <!-- Question Display -->
        <div class="question-container" id="question-container">
          <div class="question-header">
            <span class="question-number" id="question-number">Soru 1</span>
            <div class="timer-display" id="timer-display">30</div>
          </div>
          
          <div class="question-content">
            <h3 class="question-text" id="question-text">
              Yarışma başlatılmaya hazır...
            </h3>
          </div>
        </div>

        <!-- Audio Controls -->
        <div class="audio-controls" id="audio-controls">
          <div class="vad-indicator" id="vad-indicator">
            <div class="vad-circle"></div>
            <span class="vad-text">Dinleniyor...</span>
          </div>
          
          <div class="audio-level" id="audio-level">
            <div class="level-bar" id="level-bar"></div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="quiz-actions" id="quiz-actions">
          <button class="btn btn-primary btn-lg" id="start-btn" onclick="startQuiz()">
            Yarışmayı Başlat
          </button>
          
          <button class="btn btn-outline" id="calibrate-btn" onclick="recalibrateAudio()" style="display: none;">
            Ses Ayarını Yenile
          </button>
          
          <button class="btn btn-secondary" id="finish-btn" onclick="finishQuiz()" style="display: none;">
            Yarışmayı Bitir
          </button>
        </div>

        <!-- Status Messages -->
        <div class="status-messages" id="status-messages">
          <!-- Status messages will appear here -->
        </div>

        <!-- Loading Overlay -->
        <div class="loading-overlay" id="loading-overlay" style="display: none;">
          <div class="loading-content">
            <div class="loading"></div>
            <p class="loading-text" id="loading-text">Yükleniyor...</p>
          </div>
        </div>
      </div>
    `;

    // Expose methods to global scope for onclick handlers
    (window as any).startQuiz = () => this.startQuiz();
    (window as any).finishQuiz = () => this.finishQuiz();
    (window as any).recalibrateAudio = () => this.recalibrateAudio();
  }

  /**
   * Update UI based on current state
   */
  private updateUI(): void {
    // Update score
    const scoreElement = document.getElementById('score-value');
    if (scoreElement) {
      scoreElement.textContent = this.quizState.totalScore.toString();
    }

    // Update question
    const questionNumberElement = document.getElementById('question-number');
    const questionTextElement = document.getElementById('question-text');
    
    if (questionNumberElement && this.quizState.currentQuestion) {
      questionNumberElement.textContent = `Soru ${this.quizState.questionIndex + 1}`;
    }
    
    if (questionTextElement && this.quizState.currentQuestion) {
      questionTextElement.textContent = this.quizState.currentQuestion.text;
    }

    // Update buttons
    const startBtn = document.getElementById('start-btn');
    const finishBtn = document.getElementById('finish-btn');
    const calibrateBtn = document.getElementById('calibrate-btn');

    if (startBtn) {
      startBtn.style.display = this.quizState.isActive ? 'none' : 'inline-flex';
    }
    
    if (finishBtn) {
      finishBtn.style.display = this.quizState.isActive ? 'inline-flex' : 'none';
    }
    
    if (calibrateBtn) {
      calibrateBtn.style.display = this.quizState.isActive ? 'inline-flex' : 'none';
    }
  }

  /**
   * Show loading state
   */
  private showLoading(message: string): void {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    
    if (overlay) overlay.style.display = 'flex';
    if (text) text.textContent = message;
  }

  /**
   * Hide loading state
   */
  private hideLoading(): void {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Show status message
   */
  private showStatus(message: string): void {
    this.showMessage(message, 'info');
  }

  /**
   * Show warning message
   */
  private showWarning(message: string): void {
    this.showMessage(message, 'warning');
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.showMessage(message, 'error');
  }

  /**
   * Show generic message
   */
  private showMessage(message: string, type: 'info' | 'warning' | 'error'): void {
    const container = document.getElementById('status-messages');
    if (!container) return;

    const messageElement = document.createElement('div');
    messageElement.className = `status-message status-message-${type}`;
    messageElement.innerHTML = `
      <span class="message-text">${message}</span>
      <button class="message-close" onclick="this.parentElement.remove()">×</button>
    `;

    container.appendChild(messageElement);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (messageElement.parentElement) {
        messageElement.remove();
      }
    }, 5000);
  }

  /**
   * Show answer feedback
   */
  private showAnswerFeedback(result: any): void {
    const message = result.isCorrect 
      ? `✅ Doğru! ${result.earnedPoints} puan kazandınız.`
      : `❌ Yanlış. Doğru cevap: ${result.correctAnswer}`;
    
    const type = result.isCorrect ? 'info' : 'warning';
    this.showMessage(message, type);
  }

  /**
   * Show calibration result
   */
  private showCalibrationResult(result: any): void {

    const calibrationMessages = {
      excellent: 'Mükemmel kalite',
      good: 'İyi kalite',
      fair: 'Orta kalite',
      poor: 'Düşük kalite'
    } as const;

    const message = calibrationMessages[result.calibrationQuality as keyof typeof calibrationMessages] || 'Kalibrasyon tamamlandı';
    const type = result.calibrationQuality === 'poor' ? 'warning' : 'info';
    
    this.showMessage(message, type);
  }

  /**
   * Show quiz results
   */
  private showQuizResults(results: any): void {
    const resultsHTML = `
      <div class="quiz-results">
        <h3>🎉 Yarışma Tamamlandı!</h3>
        <div class="results-stats">
          <div class="stat">
            <span class="stat-label">Final Puan:</span>
            <span class="stat-value">${results.finalResults.totalScore}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Doğru Cevap:</span>
            <span class="stat-value">${results.finalResults.correctAnswers}/${results.finalResults.questionsAnswered}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Liderlik Sırası:</span>
            <span class="stat-value">${results.leaderboardRank || 'Hesaplanıyor...'}</span>
          </div>
        </div>
        <div class="results-actions">
          <a href="/" class="btn btn-primary">Ana Sayfaya Dön</a>
          <a href="/register.html" class="btn btn-outline">Tekrar Oyna</a>
        </div>
      </div>
    `;

    const questionContainer = document.getElementById('question-container');
    if (questionContainer) {
      questionContainer.innerHTML = resultsHTML;
    }
  }

  /**
   * Update connection status display
   */
  private updateConnectionStatus(state: string): void {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    if (indicator && text) {
      indicator.className = `status-indicator status-${state}`;
      
      const statusTexts = {
        disconnected: 'Bağlantı yok',
        connecting: 'Bağlanıyor...',
        connected: 'Bağlı',
        reconnecting: 'Yeniden bağlanıyor...',
        failed: 'Bağlantı başarısız'
      };

      text.textContent = statusTexts[state as keyof typeof statusTexts] || state;
    }
  }

  /**
   * Update leaderboard display
   */
  private updateLeaderboardDisplay(leaderboard: any[]): void {
    console.log('Updating leaderboard display:', leaderboard);
    // This could update a mini leaderboard in the quiz interface
  }

  /**
   * Recalibrate audio
   */
  private async recalibrateAudio(): Promise<void> {
    try {
      await this.calibrateAudio();
    } catch (error) {
      console.error('Recalibration failed:', error);
      this.handleError(error);
    }
  }

  /**
   * Notify state change
   */
  private notifyStateChange(): void {
    if (this.config.onStateChange) {
      this.config.onStateChange({ ...this.quizState });
    }
  }
}

export default QuizInterface;
