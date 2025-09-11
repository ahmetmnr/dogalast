/**
 * Audio Manager
 * Microphone access, audio processing, and Voice Activity Detection
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface AudioConfig {
  sampleRate: number;
  channelCount: number;
  bufferSize: number;
  vadThreshold: number;
  enableNoiseReduction: boolean;
  enableEchoCancellation: boolean;
  enableAutoGainControl: boolean;
}

export interface VADResult {
  isSpeaking: boolean;
  energy: number;
  threshold: number;
  confidence: number;
}

export interface AudioCalibrationResult {
  backgroundNoise: number;
  recommendedThreshold: number;
  signalToNoiseRatio: number;
  calibrationQuality: 'excellent' | 'good' | 'fair' | 'poor';
}

export type AudioEventType = 
  | 'speechStart' 
  | 'speechEnd' 
  | 'audioData' 
  | 'vadResult' 
  | 'calibrationComplete'
  | 'error';

export interface AudioEvent {
  type: AudioEventType;
  data: any;
  timestamp: number;
}

// ============================================================================
// Audio Manager Class
// ============================================================================

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  
  private config: AudioConfig;
  private isRecording = false;
  private isSpeaking = false;
  private vadBuffer: number[] = [];
  private vadBufferSize = 10; // 10 frames for smoothing
  private backgroundNoise = 0;
  private isCalibrated = false;
  
  private eventListeners = new Map<AudioEventType, Set<(event: AudioEvent) => void>>();

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = {
      sampleRate: 24000,
      channelCount: 1,
      bufferSize: 4096,
      vadThreshold: 0.01,
      enableNoiseReduction: true,
      enableEchoCancellation: true,
      enableAutoGainControl: true,
      ...config
    };
  }

  /**
   * Initialize audio system
   */
  async initialize(): Promise<void> {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.sampleRate
      });

      // Request microphone access
      await this.requestMicrophoneAccess();

      // Setup audio processing pipeline
      this.setupAudioPipeline();

      console.log('Audio system initialized successfully');

    } catch (error) {
      console.error('Audio initialization failed:', error);
      this.emitEvent('error', {
        code: 'AUDIO_INIT_FAILED',
        message: 'Ses sistemi başlatılamadı',
        details: error
      });
      throw error;
    }
  }

  /**
   * Start audio recording and processing
   */
  async startRecording(): Promise<void> {
    if (!this.audioContext || !this.processorNode) {
      throw new Error('Audio system not initialized');
    }

    if (this.isRecording) {
      console.warn('Recording already in progress');
      return;
    }

    try {
      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Connect processor node (we don't connect to destination to avoid feedback)
      // this.processorNode.connect(this.audioContext.destination);

      this.isRecording = true;
      console.log('Audio recording started');

    } catch (error) {
      console.error('Failed to start recording:', error);
      this.emitEvent('error', {
        code: 'RECORDING_START_FAILED',
        message: 'Kayıt başlatılamadı',
        details: error
      });
      throw error;
    }
  }

  /**
   * Stop audio recording
   */
  async stopRecording(): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    try {
      // Disconnect processor node
      if (this.processorNode) {
        this.processorNode.disconnect();
      }

      this.isRecording = false;
      this.isSpeaking = false;

      console.log('Audio recording stopped');

    } catch (error) {
      console.error('Failed to stop recording:', error);
      throw error;
    }
  }

  /**
   * Calibrate VAD threshold based on environment noise
   */
  async calibrateVAD(durationMs: number = 3000): Promise<AudioCalibrationResult> {
    if (!this.isRecording) {
      throw new Error('Recording must be active for calibration');
    }

    console.log(`Starting VAD calibration for ${durationMs}ms...`);

    const samples: number[] = [];
    const startTime = Date.now();

    // Collect background noise samples
    return new Promise((resolve) => {
      const collectSample = () => {
        if (Date.now() - startTime < durationMs) {
          if (this.analyserNode) {
            const dataArray = new Float32Array(this.analyserNode.frequencyBinCount);
            this.analyserNode.getFloatTimeDomainData(dataArray);

            // Calculate RMS energy
            const energy = this.calculateRMSEnergy(dataArray);
            samples.push(energy);
          }

          setTimeout(collectSample, 100); // Sample every 100ms
        } else {
          // Calculate calibration results
          const result = this.processCalibrationSamples(samples);

          this.backgroundNoise = result.backgroundNoise;
          this.config.vadThreshold = result.recommendedThreshold;
          this.isCalibrated = true;

          console.log('VAD calibration completed:', result);

          this.emitEvent('calibrationComplete', result);
          resolve(result);
        }
      };

      collectSample();
    });
  }

  /**
   * Get current VAD threshold
   */
  getVADThreshold(): number {
    return this.config.vadThreshold;
  }

  /**
   * Set VAD threshold manually
   */
  setVADThreshold(threshold: number): void {
    this.config.vadThreshold = Math.max(0.001, Math.min(0.1, threshold));
    console.log('VAD threshold set to:', this.config.vadThreshold);
  }

  /**
   * Check if currently speaking
   */
  isSpeakingNow(): boolean {
    return this.isSpeaking;
  }

  /**
   * Get audio context
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Add event listener
   */
  addEventListener(type: AudioEventType, listener: (event: AudioEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(type: AudioEventType, listener: (event: AudioEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Cleanup audio resources
   */
  async cleanup(): Promise<void> {
    try {
      await this.stopRecording();

      // Close audio nodes
      if (this.processorNode) {
        this.processorNode.disconnect();
        this.processorNode = null;
      }

      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }

      if (this.analyserNode) {
        this.analyserNode.disconnect();
        this.analyserNode = null;
      }

      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }

      // Stop media stream
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      // Close audio context
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }

      console.log('Audio system cleaned up');

    } catch (error) {
      console.error('Audio cleanup failed:', error);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Request microphone access with optimal settings
   */
  private async requestMicrophoneAccess(): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: {
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channelCount,
        echoCancellation: this.config.enableEchoCancellation,
        noiseSuppression: this.config.enableNoiseReduction,
        autoGainControl: this.config.enableAutoGainControl,
        // Additional constraints for better audio quality
        sampleSize: 16,
        latency: 0.01 // 10ms latency
      },
      video: false
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Microphone access granted');

      // Log actual audio settings
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        console.log('Audio track settings:', settings);
      }

    } catch (error) {
      console.error('Microphone access denied:', error);
      
      let errorMessage = 'Mikrofon erişimi reddedildi';
      
      if (error instanceof Error) {
        switch (error.name) {
          case 'NotAllowedError':
            errorMessage = 'Mikrofon erişimi reddedildi. Lütfen tarayıcı ayarlarından mikrofon izni verin.';
            break;
          case 'NotFoundError':
            errorMessage = 'Mikrofon bulunamadı. Lütfen bir mikrofon bağlayın.';
            break;
          case 'NotReadableError':
            errorMessage = 'Mikrofon başka bir uygulama tarafından kullanılıyor.';
            break;
          case 'OverconstrainedError':
            errorMessage = 'Mikrofon istenen ayarları desteklemiyor.';
            break;
        }
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Setup audio processing pipeline
   */
  private setupAudioPipeline(): void {
    if (!this.audioContext || !this.mediaStream) {
      throw new Error('Audio context or media stream not available');
    }

    // Create source node
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create analyser node for VAD
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    // Create processor node for audio processing
    this.processorNode = this.audioContext.createScriptProcessor(
      this.config.bufferSize,
      this.config.channelCount,
      this.config.channelCount
    );

    // Setup audio processing callback
    this.processorNode.onaudioprocess = (event) => {
      this.processAudioBuffer(event);
    };

    // Connect audio pipeline
    this.sourceNode
      .connect(this.analyserNode)
      .connect(this.gainNode)
      .connect(this.processorNode);

    console.log('Audio pipeline setup completed');
  }

  /**
   * Process audio buffer and perform VAD
   */
  private processAudioBuffer(event: AudioProcessingEvent): void {
    if (!this.isRecording) {
      return;
    }

    const inputBuffer = event.inputBuffer;
    const inputData = inputBuffer.getChannelData(0);

    // Calculate audio energy
    const energy = this.calculateRMSEnergy(inputData);

    // Perform voice activity detection
    const vadResult = this.performVAD(energy);

    // Emit VAD result
    this.emitEvent('vadResult', vadResult);

    // Check for speech start/end
    const wasSpeaking = this.isSpeaking;
    this.isSpeaking = vadResult.isSpeaking;

    if (!wasSpeaking && this.isSpeaking) {
      console.log('Speech started - Energy:', energy, 'Threshold:', vadResult.threshold);
      this.emitEvent('speechStart', {
        energy,
        threshold: vadResult.threshold,
        timestamp: Date.now()
      });
    } else if (wasSpeaking && !this.isSpeaking) {
      console.log('Speech ended - Energy:', energy, 'Threshold:', vadResult.threshold);
      this.emitEvent('speechEnd', {
        energy,
        threshold: vadResult.threshold,
        timestamp: Date.now()
      });
    }

    // Emit audio data if speaking or if forced
    if (this.isSpeaking || true) { // Always emit for now, filtering can be done later
      // Convert Float32Array to Int16Array (PCM 16-bit)
      const pcmData = this.floatToPCM16(inputData);

      this.emitEvent('audioData', {
        audioData: pcmData.buffer,
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channelCount,
        energy: energy,
        isSpeaking: this.isSpeaking
      });
    }
  }

  /**
   * Perform voice activity detection
   */
  private performVAD(energy: number): VADResult {
    // Add energy to smoothing buffer
    this.vadBuffer.push(energy);
    if (this.vadBuffer.length > this.vadBufferSize) {
      this.vadBuffer.shift();
    }

    // Calculate smoothed energy
    const smoothedEnergy = this.vadBuffer.reduce((sum, val) => sum + val, 0) / this.vadBuffer.length;

    // Adaptive threshold based on background noise
    const adaptiveThreshold = this.isCalibrated 
      ? Math.max(this.config.vadThreshold, this.backgroundNoise * 2.5)
      : this.config.vadThreshold;

    // Determine if speaking
    const isSpeaking = smoothedEnergy > adaptiveThreshold;

    // Calculate confidence
    const confidence = Math.min(1.0, smoothedEnergy / adaptiveThreshold);

    return {
      isSpeaking,
      energy: smoothedEnergy,
      threshold: adaptiveThreshold,
      confidence
    };
  }

  /**
   * Calculate RMS energy of audio data
   */
  private calculateRMSEnergy(audioData: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    return Math.sqrt(sum / audioData.length);
  }

  /**
   * Process calibration samples to determine optimal VAD threshold
   */
  private processCalibrationSamples(samples: number[]): AudioCalibrationResult {
    if (samples.length === 0) {
      return {
        backgroundNoise: 0.01,
        recommendedThreshold: 0.02,
        signalToNoiseRatio: 0,
        calibrationQuality: 'poor'
      };
    }

    // Calculate statistics
    const sortedSamples = samples.sort((a, b) => a - b);
    const median = sortedSamples[Math.floor(sortedSamples.length / 2)];
    const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length;
    const std = Math.sqrt(
      samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length
    );

    // Background noise is the 75th percentile (to exclude occasional spikes)
    const backgroundNoise = sortedSamples[Math.floor(sortedSamples.length * 0.75)];

    // Recommended threshold is 2.5x background noise
    const recommendedThreshold = Math.max(0.005, backgroundNoise * 2.5);

    // Signal-to-noise ratio estimation
    const signalToNoiseRatio = backgroundNoise > 0 ? (mean / backgroundNoise) : 0;

    // Determine calibration quality
    let calibrationQuality: AudioCalibrationResult['calibrationQuality'];
    if (std < backgroundNoise * 0.5 && signalToNoiseRatio > 3) {
      calibrationQuality = 'excellent';
    } else if (std < backgroundNoise && signalToNoiseRatio > 2) {
      calibrationQuality = 'good';
    } else if (signalToNoiseRatio > 1.5) {
      calibrationQuality = 'fair';
    } else {
      calibrationQuality = 'poor';
    }

    return {
      backgroundNoise,
      recommendedThreshold,
      signalToNoiseRatio,
      calibrationQuality
    };
  }

  /**
   * Convert Float32Array to PCM 16-bit
   */
  private floatToPCM16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] and convert to 16-bit
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = Math.floor(clamped * 0x7FFF);
    }

    return pcm16;
  }

  /**
   * Emit audio event to listeners
   */
  private emitEvent(type: AudioEventType, data: any): void {
    const event: AudioEvent = {
      type,
      data,
      timestamp: Date.now()
    };

    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('Audio event listener error:', error);
        }
      });
    }
  }
}

// ============================================================================
// Audio Utilities
// ============================================================================

export class AudioUtils {
  /**
   * Check if browser supports required audio features
   */
  static checkBrowserSupport(): {
    supported: boolean;
    missing: string[];
  } {
    const missing: string[] = [];

    if (!window.AudioContext && !(window as any).webkitAudioContext) {
      missing.push('Web Audio API');
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      missing.push('getUserMedia API');
    }

    if (!window.WebSocket) {
      missing.push('WebSocket');
    }

    return {
      supported: missing.length === 0,
      missing
    };
  }

  /**
   * Request microphone permission proactively
   */
  static async requestMicrophonePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Stop the stream immediately (we just wanted to check permission)
      stream.getTracks().forEach(track => track.stop());
      
      return true;
    } catch (error) {
      console.error('Microphone permission check failed:', error);
      return false;
    }
  }

  /**
   * Get available audio input devices
   */
  static async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audioinput');
    } catch (error) {
      console.error('Failed to enumerate audio devices:', error);
      return [];
    }
  }

  /**
   * Play audio from ArrayBuffer
   */
  static async playAudio(
    audioContext: AudioContext, 
    audioData: ArrayBuffer,
    sampleRate: number = 24000
  ): Promise<void> {
    try {
      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(
        1, // mono
        audioData.byteLength / 2, // 16-bit samples
        sampleRate
      );

      // Convert PCM16 to Float32
      const int16Array = new Int16Array(audioData);
      const float32Array = audioBuffer.getChannelData(0);

      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 0x7FFF;
      }

      // Create source and play
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();

    } catch (error) {
      console.error('Failed to play audio:', error);
      throw error;
    }
  }
}

