/**
 * WebRTC Client for OpenAI Realtime API
 * Based on your example implementation
 */

export class WebRTCClient {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private ephemeralToken: string | null = null;

  constructor(private config: {
    onConnectionStateChange?: (state: string) => void;
    onDataChannelOpen?: () => void;
    onDataChannelClose?: () => void;
    onEventReceived?: (event: any) => Promise<void>;
    onRemoteTrack?: (stream: MediaStream) => void;
    onError?: (error: Error) => void;
  }) {}

  async start(): Promise<void> {
    try {
      console.log('🔌 Starting WebRTC connection...');
      
      // Prevent multiple simultaneous connections
      if (this.pc && this.pc.connectionState !== 'closed') {
        console.log('⚠️ Connection already exists, closing first');
        this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Get ephemeral token with retry logic
      let tokenResponse;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          tokenResponse = await fetch(`http://localhost:8787/api/quiz/realtime/ephemeral-token?sessionId=${Date.now()}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('zero_waste_auth_token')}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (tokenResponse.ok) break;
          
        } catch (error) {
          console.warn(`Token request attempt ${retryCount + 1} failed:`, error);
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }

      if (!tokenResponse || !tokenResponse.ok) {
        throw new Error('Failed to get ephemeral token after retries');
      }

      const tokenData = await tokenResponse.json() as any;
      this.ephemeralToken = tokenData.data.token;

      console.log('✅ Got ephemeral token');
      
      // Create RTCPeerConnection with stable configuration
      this.pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 0,
        bundlePolicy: 'balanced',
        rtcpMuxPolicy: 'require'
      });

      // Data channel oluştur
      this.dataChannel = this.pc.createDataChannel('oai-events', {
        ordered: true
      });

      this.dataChannel.onopen = () => {
        console.log('✅ Data channel opened');
        this.config.onDataChannelOpen?.();
      };

      this.dataChannel.onclose = () => {
        console.log('❌ Data channel closed');
        this.config.onDataChannelClose?.();
      };

      this.dataChannel.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          await this.config.onEventReceived?.(data);
        } catch (err) {
          console.error('❌ Error parsing message:', err);
        }
      };

      // Connection state monitoring with stability checks
      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState || 'disconnected';
        console.log('🔗 Connection state:', state);
        
        if (state === 'connected') {
          console.log('✅ WebRTC connection stable');
          this.config.onConnectionStateChange?.(state);
        } else if (state === 'failed' || state === 'disconnected') {
          console.log('❌ Connection failed, will retry');
          setTimeout(() => {
            if (this.pc?.connectionState === 'failed') {
              this.handleConnectionFailure();
            }
          }, 2000);
        } else {
          this.config.onConnectionStateChange?.(state);
        }
      };

      // Remote track handling for audio
      this.pc.ontrack = (event) => {
        console.log('🎵 Remote track received');
        const [stream] = event.streams;

        if (!this.audioElement) {
          this.audioElement = document.createElement('audio');
          this.audioElement.autoplay = true;
          document.body.appendChild(this.audioElement);
        }

        if (stream) {
          this.audioElement.srcObject = stream;
          this.config.onRemoteTrack?.(stream);
        }
      };

      // Get user media for microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000,
        },
      });

      stream.getTracks().forEach(track => {
        this.pc?.addTrack(track, stream);
      });

      // Create offer and connect to OpenAI
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      const response = await fetch('https://api.openai.com/v1/realtime', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.ephemeralToken}`,
          'Content-Type': 'application/sdp'
        },
        body: this.pc.localDescription?.sdp
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ OpenAI API Error:', response.status, errorText);
        throw new Error(`Failed to connect to OpenAI: ${response.status} - ${errorText}`);
      }

      const answerSdp = await response.text();
      await this.pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      });

      console.log('✅ WebRTC connection established');

    } catch (error) {
      console.error('WebRTC start error:', error);
      this.config.onError?.(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Handle connection failure with retry logic
   */
  private handleConnectionFailure(): void {
    console.log('🔄 Handling connection failure...');
    this.disconnect();
    
    // Retry after delay
    setTimeout(() => {
      console.log('🔄 Retrying WebRTC connection...');
      this.start().catch(error => {
        console.error('Retry failed:', error);
        this.config.onError?.(error);
      });
    }, 5000);
  }

  sendEvent(event: any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(event));
    } else {
      console.warn('Data channel not ready');
    }
  }

  /**
   * Send tool execution result back to OpenAI
   */
  sendToolResult(callId: string, result: any): void {
    const toolResponse = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result)
      }
    };
    
    this.sendEvent(toolResponse);
  }

  disconnect(): void {
    console.log('🔌 Disconnecting WebRTC...');
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.audioElement) {
      this.audioElement.remove();
      this.audioElement = null;
    }
  }
}
