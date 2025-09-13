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
      
      // Get ephemeral token from backend (correct endpoint)
      const tokenResponse = await fetch('http://localhost:8787/api/quiz/realtime/ephemeral-token?sessionId=' + Date.now(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('zero_waste_auth_token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to get ephemeral token');
      }

      const tokenData = await tokenResponse.json() as any;
      this.ephemeralToken = tokenData.data.token;

      console.log('✅ Got ephemeral key:', this.ephemeralToken?.substring(0, 10) + '...');
      
      // RTCPeerConnection oluştur
      this.pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
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

      // Connection state monitoring
      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState || 'disconnected';
        console.log('🔗 Connection state:', state);
        this.config.onConnectionStateChange?.(state);
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
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
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
      console.error('Connection error:', error);
      this.config.onError?.(error instanceof Error ? error : new Error('Unknown error'));
    }
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
