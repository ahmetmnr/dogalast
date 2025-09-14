/**
 * Quiz Interface Component
 * Integrates audio, realtime, and quiz functionality
 */

import { AudioManager, type AudioEvent } from '../core/AudioManager';
import { RealtimeClient } from '../core/RealtimeClient';
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
  currentQuestionStartTime?: number;
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
  private webrtcClient: any = null; // WebRTCClient instance
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
      // Browser support check removed for now
      const browserSupport = { supported: true, missing: [] };
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

      // Start quiz via API - sessionId optional for first call
      const response = await api.tools.startQuiz(this.quizState.sessionId || undefined);

      if (response.success && response.data) {
        console.log('Quiz started, response data:', response.data);
        this.quizState.sessionId = response.data.sessionId;
        this.quizState.currentQuestion = response.data.currentQuestion;
        this.quizState.totalScore = response.data.totalScore;
        this.quizState.questionIndex = response.data.questionIndex;
        this.quizState.isActive = true;
        this.quizState.currentSessionQuestionId = response.data.currentQuestion?.sessionQuestionId;
        
        // Start quiz timer
        localStorage.setItem('quizStartTime', Date.now().toString());
        
        // Start timer update interval
        const timerInterval = setInterval(() => {
          if (this.quizState.isActive) {
            this.updateTimerDisplay();
          } else {
            clearInterval(timerInterval);
          }
        }, 1000);
        
        // Store interval for cleanup
        this.cleanupFunctions.push(() => clearInterval(timerInterval));
        
        // Start VAD indicator update interval
        const vadInterval = setInterval(() => {
          if (this.quizState.isActive && this.audioManager) {
            this.updateStatusIndicators();
          } else {
            clearInterval(vadInterval);
          }
        }, 100); // Update VAD indicator every 100ms
        
        // Store VAD interval for cleanup
        this.cleanupFunctions.push(() => clearInterval(vadInterval));
        
        // Save sessionId to localStorage
        localStorage.setItem('currentSessionId', response.data.sessionId);

        // Initialize WebRTC connection to OpenAI Realtime API (only if not already connected)
        if (!this.webrtcClient) {
          await this.initializeWebRTCConnection();
          console.log('✅ WebRTC OpenAI connection initialized');
        } else {
          console.log('ℹ️ WebRTC connection already exists, reusing');
        }

        // Start audio recording
        await this.audioManager.startRecording();

        // Calibrate VAD
        await this.calibrateAudio();

        // Present first question
        await this.presentCurrentQuestion();

        this.updateUI();
        this.updateUIEnhanced();
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
        Date.now(),
        this.quizState.sessionId || undefined
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

  // Cleanup method moved to end of class

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Initialize OpenAI Realtime connection
   */
  private async initializeWebRTCConnection(): Promise<void> {
    if (!this.quizState.sessionId) {
      throw new Error('Session ID required for WebRTC connection');
    }
    
    const { WebRTCClient } = await import('../core/WebRTCClient');
    
    const webrtcClient = new WebRTCClient({
      onDataChannelOpen: () => {
        console.log('✅ WebRTC ready, asking OpenAI to read question');
        
        // Send question to OpenAI to be read aloud
        if (this.quizState.currentQuestion) {
          const questionText = `Soru ${this.quizState.questionIndex + 1}: ${this.quizState.currentQuestion.text}. Seçenekler: ${this.quizState.currentQuestion.options.join(', ')}`;
          
          webrtcClient.sendEvent({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: questionText
              }]
            }
          });
          
          webrtcClient.sendEvent({
            type: 'response.create',
            response: { modalities: ['text', 'audio'] }
          });
        }
      },
      onEventReceived: async (event) => {
        await this.handleOpenAIMessage(event);
      },
      onError: (error) => {
        console.error('WebRTC error:', error);
      }
    });

    await webrtcClient.start();
    this.webrtcClient = webrtcClient;
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
        await api.tools.markTTSEnd(question.sessionQuestionId, Date.now(), this.quizState.sessionId || undefined);
      }

      // Use browser's built-in TTS for question reading
      const questionText = `Soru ${this.quizState.questionIndex + 1}: ${question.text}`;
      this.speakText(questionText);

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

        this.updateUIEnhanced();
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
   * Speak text using browser's built-in TTS
   */
  private speakText(text: string): void {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'tr-TR';
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.volume = 0.8;
      
      utterance.onstart = () => {
        console.log('🔊 TTS started:', text);
      };
      
      utterance.onend = async () => {
        console.log('🔊 TTS completed');

        // Mark TTS end for timer calculation
        if (this.quizState.currentQuestion?.sessionQuestionId) {
          try {
            await api.tools.markTTSEnd(
              this.quizState.currentQuestion.sessionQuestionId,
              Date.now(),
              this.quizState.sessionId || undefined
            );
            console.log('✅ TTS end marked for timer calculation');
          } catch (error) {
            console.error('❌ Failed to mark TTS end:', error);
          }
        }

        // Start listening for user answer
        this.startListeningForAnswer();
        this.updateUIEnhanced();
      };
      
      utterance.onerror = (error) => {
        console.error('🚨 TTS error:', error);
      };
      
      speechSynthesis.speak(utterance);
    } else {
      console.warn('⚠️ Speech synthesis not supported');
    }
  }

  /**
   * Start listening for user answer using browser Speech Recognition
   */
  private startListeningForAnswer(): void {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.warn('⚠️ Speech recognition not supported');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'tr-TR';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('🎤 Listening for answer...');
      this.quizState.isWaitingForAnswer = true;
      this.updateUI();
    };

    recognition.onresult = async (event: any) => {
      const result = event.results[event.results.length - 1];
      const transcript = result.transcript;
      
      if (result.isFinal) {
        console.log('🗣️ User answer:', transcript);
        await this.handleUserAnswer(transcript);
      } else {
        console.log('🗣️ Interim result:', transcript);
      }
    };

    recognition.onerror = (error: any) => {
      console.error('🚨 Speech recognition error:', error);
      this.quizState.isWaitingForAnswer = false;
      this.updateUI();
    };

    recognition.onend = () => {
      console.log('🎤 Speech recognition ended');
      this.quizState.isWaitingForAnswer = false;
      this.updateUI();
    };

    // Start recognition with timeout
    recognition.start();
    
    // Auto-stop after 30 seconds
    setTimeout(() => {
      recognition.stop();
    }, 30000);
  }

  /**
   * Handle user's spoken answer
   */
  private async handleUserAnswer(transcript: string): Promise<void> {
    try {
      console.log('📝 Processing answer:', transcript);
      console.log('📝 Current question state:', {
        currentQuestion: this.quizState.currentQuestion,
        sessionQuestionId: this.quizState.currentQuestion?.sessionQuestionId
      });

      if (!this.quizState.currentQuestion) {
        throw new Error('No active question');
      }

      if (!this.quizState.currentQuestion.sessionQuestionId) {
        throw new Error('No session question ID');
      }

      // Submit answer via API
      const response = await api.tools.submitAnswer(
        this.quizState.currentQuestion.sessionQuestionId,
        transcript,
        0.8, // confidence
        Date.now(), // clientTimestamp
        this.quizState.sessionId || undefined // sessionId
      );

      if (response.success) {
        console.log('✅ Answer submitted successfully');
        // Show feedback and proceed to next question
        this.showAnswerFeedback(response.data);
        
        // Wait 3 seconds then next question
        setTimeout(async () => {
          await this.loadNextQuestion();
        }, 3000);
      }

    } catch (error) {
      console.error('❌ Failed to process answer:', error);
      this.handleError(error);
    }
  }

  // Realtime handlers removed for now to fix syntax errors

  /**
   * Load next question
   */
  private async loadNextQuestion(): Promise<void> {
    try {
      const response = await api.tools.nextQuestion(this.quizState.sessionId || '');
      if (response.success && response.data) {
        this.quizState.currentQuestion = response.data.currentQuestion;
        this.quizState.questionIndex = response.data.questionIndex || this.quizState.questionIndex + 1;
        this.quizState.currentSessionQuestionId = response.data.currentQuestion?.sessionQuestionId;
        this.updateUI();
        this.updateUIEnhanced();
        
        // Start listening for answer after a brief delay
        setTimeout(() => {
          this.startListeningForAnswer();
        }, 1000);
      } else {
        // Quiz finished
        console.log('✅ Quiz completed');
        this.showStatus('Yarışma tamamlandı!');
      }
    } catch (error) {
      console.error('Failed to load next question:', error);
      this.handleError(error);
    }
  }

  // handleRealtimeError removed (unused)

  /**
   * Handle quiz events from WebSocket
   */
  private handleQuizEvent(event: any): void {
    console.log('Quiz event received:', event);
    // Handle real-time quiz events (e.g., session updates)
  }

  /**
   * Handle OpenAI Realtime API messages
   */
  private async handleOpenAIMessage(event: any): Promise<void> {
    console.log('📨 OpenAI Event:', event.type, event);
    
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          console.log('🗣️ User answer:', event.transcript);
          await this.handleUserAnswer(event.transcript);
        }
        break;
        
      case 'response.function_call_delta':
        // OpenAI function call in progress
        console.log('⚙️ Function call delta:', event);
        this.updateToolCallStatus(event);
        break;
        
      case 'response.function_call_done':
        // Execute the tool call
        console.log('✅ Function call done:', event);
        await this.executeToolCall(event.call);
        break;
        
      case 'response.audio.delta':
        // Play audio chunk
        console.log('🔊 Audio delta received');
        await this.handleAudioDelta(event.delta);
        break;
        
      case 'response.audio.done':
        // Audio playback complete
        console.log('🔊 OpenAI finished speaking');
        await this.handleTTSEnd();
        break;
        
      case 'response.done':
        console.log('✅ Response complete');
        break;
        
      default:
        console.log('📝 Unhandled event:', event.type);
    }
  }

  /**
   * Update tool call status in UI
   */
  private updateToolCallStatus(event: any): void {
    // Show tool call progress in UI
    this.showStatus(`🔧 ${event.name || 'Tool'} çalışıyor...`);
  }

  /**
   * Execute tool call from OpenAI
   */
  private async executeToolCall(call: any): Promise<void> {
    try {
      const { name, arguments: args } = call;
      console.log('🔧 Executing tool:', name, args);
      
      // Parse arguments if string
      let parsedArgs = args;
      if (typeof args === 'string') {
        parsedArgs = JSON.parse(args);
      }
      
      // Execute tool via backend
      const response = await api.tools.dispatch({
        tool: name,
        args: parsedArgs,
        sessionId: this.quizState.sessionId || undefined
      });
      
      // Send result back to OpenAI
      if (this.webrtcClient) {
        this.webrtcClient.sendToolResult(call.call_id, response.data);
      }
      
      // Update UI based on tool response
      this.updateQuizState(response.data);
      
      console.log('✅ Tool executed:', name, response.data);
      
    } catch (error) {
      console.error('❌ Tool execution failed:', error);
      
      // Send error back to OpenAI
      if (this.webrtcClient && call.call_id) {
        this.webrtcClient.sendToolResult(call.call_id, {
          error: 'Tool execution failed',
          message: (error as Error).message
        });
      }
    }
  }

  /**
   * Handle audio delta from OpenAI
   */
  private async handleAudioDelta(delta: string): Promise<void> {
    try {
      if (!delta || delta.length === 0) {
        return;
      }
      
      if (this.audioManager) {
        // Direct method call on AudioManager
        await this.audioManager.playAudioChunk(delta);
      } else {
        console.warn('⚠️ AudioManager not initialized for audio playback');
      }
      
    } catch (error) {
      console.error('❌ Audio delta playback failed:', error);
    }
  }

  /**
   * Handle TTS end
   */
  private async handleTTSEnd(): Promise<void> {
    try {
      // Mark TTS end and start question timer
      if (this.quizState.currentQuestion?.sessionQuestionId) {
        await api.tools.markTTSEnd(
          this.quizState.currentQuestion.sessionQuestionId,
          Date.now(),
          this.quizState.sessionId || undefined
        );

        // Start question timer
        this.quizState.currentQuestionStartTime = Date.now();
        console.log('🕒 Timer started at:', this.quizState.currentQuestionStartTime);

        // Update UI to show timer started
        this.updateUIEnhanced();

        console.log('✅ TTS ended, question timer started');
      } else {
        console.warn('⚠️ No sessionQuestionId available for TTS end handling');
      }
    } catch (error) {
      console.error('❌ Failed to handle TTS end:', error);
    }
  }

  /**
   * Update quiz state based on tool response with comprehensive UI updates
   */
  private updateQuizState(toolResponse: any): void {
    console.log('🔄 Updating quiz state:', toolResponse);
    
    // Session ID updates
    if (toolResponse.sessionId) {
      this.quizState.sessionId = toolResponse.sessionId;
      localStorage.setItem('currentSessionId', toolResponse.sessionId);
    }
    
    // Question updates
    if (toolResponse.currentQuestion) {
      this.quizState.currentQuestion = toolResponse.currentQuestion;
      this.showStatus(`📝 Soru ${this.quizState.questionIndex + 1} yüklendi`);
    }
    
    // Score updates with animation
    if (typeof toolResponse.totalScore === 'number') {
      const oldScore = this.quizState.totalScore;
      this.quizState.totalScore = toolResponse.totalScore;
      
      if (toolResponse.totalScore > oldScore) {
        this.animateScoreIncrease(oldScore, toolResponse.totalScore);
      }
    }
    
    // Progress updates
    if (typeof toolResponse.questionIndex === 'number') {
      this.quizState.questionIndex = toolResponse.questionIndex;
      this.updateProgressBar();
    }
    
    // Answer feedback
    if (toolResponse.answerResult) {
      this.showAnswerFeedback(toolResponse.answerResult);
    }
    
    // Quiz completion
    if (toolResponse.quizCompleted) {
      this.handleQuizCompletion(toolResponse);
    }
    
    // Real-time leaderboard updates
    if (toolResponse.leaderboardPosition) {
      this.updateLeaderboardPosition(toolResponse.leaderboardPosition);
    }
    
    // Update main UI with enhanced features
    this.updateUIEnhanced();
    
    // Trigger state change notifications
    this.notifyStateChange();
    
    console.log('✅ Quiz state updated successfully');
  }
  
  // Duplicate methods removed - using enhanced versions at end of class

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
            <div class="question-options" id="question-options">
              <!-- Soru seçenekleri burada gösterilecek -->
            </div>

            <!-- Test Input for Manual Answer -->
            <div class="manual-answer" id="manual-answer" style="margin-top: 20px;">
              <input type="text" id="answer-input" placeholder="Cevabınızı yazın (test için)" style="padding: 10px; width: 200px;">
              <button id="submit-answer-btn" style="padding: 10px; margin-left: 10px;">Cevap Gönder</button>
            </div>
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

    // Add manual answer submission for testing
    const submitBtn = document.getElementById('submit-answer-btn');
    const answerInput = document.getElementById('answer-input') as HTMLInputElement;

    if (submitBtn && answerInput) {
      submitBtn.addEventListener('click', async () => {
        const answer = answerInput.value.trim();
        if (answer) {
          await this.handleUserAnswer(answer);
          answerInput.value = '';
        }
      });

      answerInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          const answer = answerInput.value.trim();
          if (answer) {
            await this.handleUserAnswer(answer);
            answerInput.value = '';
          }
        }
      });
    }
  }

  /**
   * Update UI based on current state
   */
  private updateUI(): void {
    console.log('updateUI called with state:', this.quizState);

    // Update score
    const scoreElement = document.getElementById('score-value');
    if (scoreElement) {
      scoreElement.textContent = this.quizState.totalScore.toString();
    }

    // Update question
    const questionNumberElement = document.getElementById('question-number');
    const questionTextElement = document.getElementById('question-text');

    console.log('Question elements found:', {
      questionNumber: !!questionNumberElement,
      questionText: !!questionTextElement,
      currentQuestion: !!this.quizState.currentQuestion
    });
    
    if (questionNumberElement && this.quizState.currentQuestion) {
      questionNumberElement.textContent = `Soru ${this.quizState.questionIndex + 1}`;
    }
    
    if (questionTextElement && this.quizState.currentQuestion) {
      questionTextElement.textContent = this.quizState.currentQuestion.text;
    }

    // Update options
    const optionsElement = document.getElementById('question-options');
    if (optionsElement && this.quizState.currentQuestion && this.quizState.currentQuestion.options) {
      optionsElement.innerHTML = this.quizState.currentQuestion.options
        .map((option: string, index: number) => `
          <div class="option-item">
            <span class="option-letter">${String.fromCharCode(65 + index)}</span>
            <span class="option-text">${option}</span>
          </div>
        `).join('');
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
   * Animate score increase with smooth transition
   */
  private animateScoreIncrease(oldScore: number, newScore: number): void {
    const scoreElement = document.getElementById('current-score') || document.getElementById('score-value');
    if (!scoreElement) return;
    
    const difference = newScore - oldScore;
    const duration = 1000; // 1 second
    const steps = 20;
    const stepValue = difference / steps;
    const stepDuration = duration / steps;
    
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      const currentScore = Math.round(oldScore + (stepValue * currentStep));
      scoreElement.textContent = currentScore.toString();
      
      // Add visual feedback
      scoreElement.style.color = '#4CAF50';
      scoreElement.style.transform = `scale(${1 + (0.1 * Math.sin(currentStep / steps * Math.PI))})`;
      
      if (currentStep >= steps) {
        clearInterval(interval);
        scoreElement.textContent = newScore.toString();
        scoreElement.style.transform = 'scale(1)';
        scoreElement.style.color = '';
        
        // Show score increase animation
        const increaseElement = document.createElement('div');
        increaseElement.className = 'score-increase';
        increaseElement.textContent = `+${difference}`;
        increaseElement.style.cssText = `
          position: absolute;
          top: -30px;
          right: 0;
          background: #4CAF50;
          color: white;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: bold;
          z-index: 1000;
          animation: scoreIncrease 2s ease-out forwards;
        `;
        
        if (scoreElement.parentElement) {
          scoreElement.parentElement.style.position = 'relative';
          scoreElement.parentElement.appendChild(increaseElement);
        }
        
        setTimeout(() => increaseElement.remove(), 2000);
      }
    }, stepDuration);
  }

  // showScoreIncrease method removed (integrated into animateScoreIncrease)
  
  /**
   * Update progress bar with smooth animation
   */
  private updateProgressBar(): void {
    const progressBar = document.getElementById('quiz-progress');
    const progressText = document.getElementById('progress-text');
    const progressContainer = document.getElementById('progress-container');
    
    if (progressBar && progressText) {
      const totalQuestions = 10; // Get from quiz config
      const progress = Math.min((this.quizState.questionIndex / totalQuestions) * 100, 100);
      
      // Smooth progress bar animation
      progressBar.style.transition = 'width 0.5s ease';
      progressBar.style.width = `${progress}%`;
      
      // Update text
      progressText.textContent = `Soru ${this.quizState.questionIndex}/${totalQuestions}`;
      
      // Visual feedback for progress
      if (progressContainer) {
        progressContainer.style.transform = 'scale(1.05)';
        setTimeout(() => {
          progressContainer.style.transform = 'scale(1)';
        }, 200);
      }
      
      // Progress milestone feedback
      if (progress === 25 || progress === 50 || progress === 75) {
        this.showStatus(`🎯 %${progress} tamamlandı!`);
      }
    }
  }
  
  /**
   * Update leaderboard position with visual feedback
   */
  private updateLeaderboardPosition(position: any): void {
    const positionElement = document.getElementById('leaderboard-position');
    const rankElement = document.getElementById('current-rank');
    
    if (positionElement) {
      const oldRank = parseInt(positionElement.dataset['rank'] || '999');
      const newRank = position.rank;
      
      positionElement.textContent = `Sıralama: ${newRank}/${position.total}`;
      positionElement.dataset['rank'] = newRank.toString();
      
      // Rank improvement animation
      if (newRank < oldRank) {
        positionElement.style.color = '#4CAF50';
        positionElement.style.transform = 'scale(1.1)';
        this.showStatus(`🎉 Sıralamanız yükseldi! ${oldRank} → ${newRank}`);
        
        setTimeout(() => {
          positionElement.style.transform = 'scale(1)';
          positionElement.style.color = '';
        }, 1000);
      }
      
      // Rank-based styling
      positionElement.className = newRank <= 3 ? 'top-rank' : 
                                  newRank <= 10 ? 'good-rank' : 'normal-rank';
    }
    
    if (rankElement) {
      rankElement.textContent = `#${position.rank}`;
      rankElement.className = position.rank <= 3 ? 'medal-rank' : 'normal-rank';
    }
  }
  
  /**
   * Handle quiz completion with celebration
   */
  private handleQuizCompletion(completionData: any): void {
    this.quizState.isActive = false;
    
    // Celebration animation
    this.showCelebration(completionData.finalScore);
    
    // Show completion modal with results
    setTimeout(() => {
      this.showQuizResults({
        finalScore: completionData.finalScore || this.quizState.totalScore,
        totalQuestions: completionData.totalQuestions || 10,
        correctAnswers: completionData.correctAnswers || 0,
        timeSpent: completionData.timeSpent || '0:00',
        rank: completionData.rank || 'N/A',
        percentage: completionData.percentage || 0
      });
    }, 2000);
    
    // Cleanup resources
    setTimeout(() => {
      this.cleanup();
    }, 5000);
  }

  /**
   * Show celebration animation
   */
  private showCelebration(finalScore: number): void {
    // Create celebration overlay
    const celebration = document.createElement('div');
    celebration.className = 'celebration-overlay';
    celebration.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(76, 175, 80, 0.1);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      animation: celebrationFade 3s ease-out forwards;
    `;
    
    celebration.innerHTML = `
      <div style="text-align: center; color: #4CAF50;">
        <h1 style="font-size: 4rem; margin: 0; animation: bounce 1s ease-in-out;">🎉</h1>
        <h2 style="font-size: 2rem; margin: 10px 0;">Tebrikler!</h2>
        <p style="font-size: 1.5rem; margin: 0;">Final Skor: ${finalScore}</p>
      </div>
    `;
    
    // Add celebration CSS
    if (!document.getElementById('celebration-style')) {
      const style = document.createElement('style');
      style.id = 'celebration-style';
      style.textContent = `
        @keyframes celebrationFade {
          0% { opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-30px); }
          60% { transform: translateY(-15px); }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(celebration);
    
    // Remove after animation
    setTimeout(() => {
      if (celebration.parentNode) {
        celebration.parentNode.removeChild(celebration);
      }
    }, 3000);
  }

  /**
   * Enhanced updateUI with real-time data binding
   */
  private updateUIEnhanced(): void {
    console.log('updateUIEnhanced called with state:', this.quizState);

    // Score display
    const scoreElement = document.getElementById('score-value');
    if (scoreElement) {
      scoreElement.textContent = this.quizState.totalScore.toString();
    }

    // Question display
    const questionElement = document.getElementById('question-text');
    const questionNumberElement = document.getElementById('question-number');
    const optionsElement = document.getElementById('question-options');

    console.log('Enhanced UI elements found:', {
      questionElement: !!questionElement,
      questionNumberElement: !!questionNumberElement,
      optionsElement: !!optionsElement,
      hasCurrentQuestion: !!this.quizState.currentQuestion,
      questionData: this.quizState.currentQuestion
    });

    if (questionElement && this.quizState.currentQuestion) {
      questionElement.textContent = this.quizState.currentQuestion.text;
    }

    if (questionNumberElement && this.quizState.currentQuestion) {
      questionNumberElement.textContent = `Soru ${this.quizState.questionIndex + 1}`;
    }

    if (optionsElement && this.quizState.currentQuestion && this.quizState.currentQuestion.options) {
      optionsElement.innerHTML = this.quizState.currentQuestion.options
        .map((option: string, index: number) => `
          <div class="option-item">
            <span class="option-letter">${String.fromCharCode(65 + index)}</span>
            <span class="option-text">${option}</span>
          </div>
        `).join('');
    }
    
    // Progress bar
    const progressElement = document.getElementById('progress-bar');
    if (progressElement) {
      const progress = ((this.quizState.questionIndex + 1) / 10) * 100;
      progressElement.style.width = `${progress}%`;
    }
    
    // Status display
    const statusElement = document.getElementById('quiz-status');
    if (statusElement) {
      statusElement.textContent = this.quizState.isActive ? 'Yarışma Devam Ediyor' : 'Beklemede';
    }
    
    // Call additional updates
    this.updateScoreDisplay();
    this.updateQuestionDisplay();
    this.updateStatusIndicators();
    this.updateTimerDisplay();
  }

  /**
   * Update score display with formatting
   */
  private updateScoreDisplay(): void {
    const scoreElement = document.getElementById('score-value');
    const scoreLabel = document.getElementById('score-label');
    
    if (scoreElement) {
      scoreElement.textContent = this.quizState.totalScore.toString();
      
      // Score color based on performance
      const percentage = (this.quizState.totalScore / (this.quizState.questionIndex * 100)) * 100;
      if (percentage >= 80) {
        scoreElement.style.color = '#4CAF50'; // Green
      } else if (percentage >= 60) {
        scoreElement.style.color = '#FF9800'; // Orange
      } else {
        scoreElement.style.color = '#F44336'; // Red
      }
    }
    
    if (scoreLabel) {
      const avgScore = this.quizState.questionIndex > 0 ? 
        Math.round(this.quizState.totalScore / this.quizState.questionIndex) : 0;
      scoreLabel.textContent = `Ortalama: ${avgScore} puan`;
    }
  }

  /**
   * Update question display with enhanced formatting
   */
  private updateQuestionDisplay(): void {
    const questionText = document.getElementById('question-text');
    const questionNumber = document.getElementById('question-number');
    const optionsContainer = document.getElementById('question-options');
    
    if (this.quizState.currentQuestion) {
      if (questionText) {
        questionText.textContent = this.quizState.currentQuestion.text;
        questionText.style.animation = 'fadeIn 0.5s ease';
      }
      
      if (questionNumber) {
        questionNumber.textContent = `Soru ${this.quizState.questionIndex + 1}`;
      }
      
      if (optionsContainer && this.quizState.currentQuestion.options) {
        optionsContainer.innerHTML = this.quizState.currentQuestion.options
          .map((option: string, index: number) => `
            <div class="option-item" data-index="${index}">
              <span class="option-letter">${String.fromCharCode(65 + index)}</span>
              <span class="option-text">${option}</span>
            </div>
          `).join('');
      }
    }
  }

  /**
   * Update status indicators
   */
  private updateStatusIndicators(): void {
    const micStatus = document.getElementById('mic-status');
    const connectionStatus = document.getElementById('connection-status');
    const vadIndicator = document.getElementById('vad-indicator');
    
    if (micStatus) {
      micStatus.className = this.quizState.isWaitingForAnswer ? 'mic-active' : 'mic-inactive';
      micStatus.textContent = this.quizState.isWaitingForAnswer ? '🎤 Dinliyor...' : '🎤 Bekliyor';
    }
    
    if (connectionStatus) {
      const isConnected = this.webrtcClient !== null;
      connectionStatus.className = isConnected ? 'connected' : 'disconnected';
      connectionStatus.textContent = isConnected ? '🟢 Bağlı' : '🔴 Bağlantı Yok';
    }
    
    if (vadIndicator && this.audioManager) {
      const vadMetrics = this.audioManager.getVADMetrics?.();
      if (vadMetrics) {
        const intensity = Math.min(vadMetrics.currentRMS / vadMetrics.threshold, 1);
        vadIndicator.style.opacity = intensity.toString();
        vadIndicator.style.transform = `scale(${1 + intensity * 0.3})`;
      }
    }
  }

  /**
   * Update timer display
   */
  private updateTimerDisplay(): void {
    const startTime = localStorage.getItem('quizStartTime');
    if (!startTime || !this.quizState.isActive) return;

    const elapsed = Math.floor((Date.now() - parseInt(startTime)) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    const timerElement = document.getElementById('quiz-timer');
    if (timerElement) {
      timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // Question time limit (30 seconds per question)
    const questionStartTime = this.quizState.currentQuestionStartTime;
    console.log('🕒 Timer update - questionStartTime:', questionStartTime, 'currentTime:', Date.now());

    if (questionStartTime) {
      const questionElapsed = Math.floor((Date.now() - questionStartTime) / 1000);
      const remaining = Math.max(0, 30 - questionElapsed);

      console.log('🕒 Timer update - elapsed:', questionElapsed, 'remaining:', remaining);

      const questionTimerElement = document.getElementById('timer-display');
      if (questionTimerElement) {
        questionTimerElement.textContent = `${remaining}s`;
        questionTimerElement.className = remaining <= 10 ? 'timer-warning' : 'timer-normal';
        console.log('🕒 Timer display updated to:', `${remaining}s`);
      } else {
        console.warn('⚠️ timer-display element not found');
      }
    } else {
      console.log('🕒 No questionStartTime set, timer not running');
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

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    console.log('🧹 Cleaning up quiz resources...');
    
    // Cleanup audio
    if (this.audioManager) {
      this.audioManager.stopRecording();
    }
    
    // Cleanup WebRTC
    if (this.webrtcClient) {
      this.webrtcClient.disconnect();
      this.webrtcClient = null;
    }
    
    // Cleanup realtime client
    if (this.realtimeClient) {
      this.realtimeClient.disconnect();
      this.realtimeClient = null;
    }
    
    // Run cleanup functions
    this.cleanupFunctions.forEach(fn => {
      try {
        fn();
      } catch (error) {
        console.error('Cleanup function failed:', error);
      }
    });
    
    this.cleanupFunctions = [];
    
    console.log('✅ Cleanup completed');
  }
}

export default QuizInterface;
