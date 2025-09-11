/**
 * OpenAI Integration Type Definitions
 * Types for OpenAI Realtime API integration
 */

/**
 * Realtime API event types
 */
export interface RealtimeEvent {
  /** Event type identifier */
  type: string;
  
  /** Unique event ID */
  event_id?: string;
  
  /** Additional event properties */
  [key: string]: any;
}

/**
 * Session configuration event
 */
export interface SessionConfigEvent extends RealtimeEvent {
  type: 'session.update';
  session: {
    modalities: string[];
    instructions: string;
    voice: string;
    input_audio_format: string;
    output_audio_format: string;
    input_audio_transcription: {
      model: string;
    };
    turn_detection: {
      type: string;
      threshold: number;
      prefix_padding_ms: number;
      silence_duration_ms: number;
    };
    tools: ToolDefinition[];
    tool_choice: string;
    temperature: number;
    max_response_output_tokens: number | 'inf';
  };
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  /** Tool type (always 'function' for now) */
  type: 'function';
  
  /** Function details */
  function: {
    /** Function name */
    name: string;
    
    /** Function description */
    description: string;
    
    /** Function parameters schema */
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * Tool call structure
 */
export interface ToolCall {
  /** Unique call ID */
  call_id: string;
  
  /** Tool type */
  type: 'function';
  
  /** Function details */
  function: {
    /** Function name to call */
    name: string;
    
    /** JSON string of function arguments */
    arguments: string;
  };
}

/**
 * Tool call output
 */
export interface ToolOutput {
  /** Call ID this output responds to */
  call_id: string;
  
  /** Output data (will be JSON stringified) */
  output: any;
}

/**
 * Audio stream configuration
 */
export interface AudioConfig {
  /** Audio format */
  format: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  
  /** Sample rate in Hz */
  sampleRate: 16000 | 24000;
  
  /** Number of audio channels */
  channels: 1;
}

/**
 * Audio append event
 */
export interface AudioAppendEvent extends RealtimeEvent {
  type: 'input_audio_buffer.append';
  audio: string; // Base64 encoded audio
}

/**
 * Audio commit event
 */
export interface AudioCommitEvent extends RealtimeEvent {
  type: 'input_audio_buffer.commit';
}

/**
 * Audio clear event
 */
export interface AudioClearEvent extends RealtimeEvent {
  type: 'input_audio_buffer.clear';
}

/**
 * Transcript event (both partial and final)
 */
export interface TranscriptEvent extends RealtimeEvent {
  type: 'conversation.item.input_audio_transcription.completed' | 
        'conversation.item.input_audio_transcription.failed';
  
  /** Transcript text */
  transcript?: string;
  
  /** Confidence score (0-1) */
  confidence?: number;
  
  /** Item ID */
  item_id?: string;
  
  /** Content index */
  content_index?: number;
  
  /** Error details if failed */
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Response audio delta event
 */
export interface AudioDeltaEvent extends RealtimeEvent {
  type: 'response.audio.delta';
  
  /** Response ID */
  response_id: string;
  
  /** Item ID */
  item_id: string;
  
  /** Output index */
  output_index: number;
  
  /** Content index */
  content_index: number;
  
  /** Audio delta chunk (base64) */
  delta: string;
}

/**
 * Response audio done event
 */
export interface AudioDoneEvent extends RealtimeEvent {
  type: 'response.audio.done';
  
  /** Response ID */
  response_id: string;
  
  /** Item ID */
  item_id: string;
  
  /** Output index */
  output_index: number;
  
  /** Content index */
  content_index: number;
}

/**
 * Response text delta event
 */
export interface TextDeltaEvent extends RealtimeEvent {
  type: 'response.text.delta';
  
  /** Response ID */
  response_id: string;
  
  /** Item ID */
  item_id: string;
  
  /** Output index */
  output_index: number;
  
  /** Content index */
  content_index: number;
  
  /** Text delta */
  delta: string;
}

/**
 * Function call arguments delta
 */
export interface FunctionCallDeltaEvent extends RealtimeEvent {
  type: 'response.function_call_arguments.delta';
  
  /** Response ID */
  response_id: string;
  
  /** Item ID */
  item_id: string;
  
  /** Output index */
  output_index: number;
  
  /** Call ID */
  call_id: string;
  
  /** Arguments delta */
  delta: string;
}

/**
 * Response done event
 */
export interface ResponseDoneEvent extends RealtimeEvent {
  type: 'response.done';
  
  /** Response details */
  response: {
    id: string;
    object: string;
    status: string;
    status_details: any;
    output: any[];
    usage: {
      total_tokens: number;
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Error event
 */
export interface ErrorEvent extends RealtimeEvent {
  type: 'error';
  
  /** Error details */
  error: {
    type: string;
    code?: string;
    message: string;
    param?: string;
    event_id?: string;
  };
}

/**
 * Rate limit event
 */
export interface RateLimitEvent extends RealtimeEvent {
  type: 'rate_limits.updated';
  
  /** Rate limit details */
  rate_limits: Array<{
    name: string;
    limit: number;
    remaining: number;
    reset_seconds: number;
  }>;
}

/**
 * Conversation item
 */
export interface ConversationItem {
  /** Item ID */
  id?: string;
  
  /** Item type */
  type: 'message' | 'function_call' | 'function_call_output';
  
  /** Role */
  role: 'user' | 'assistant' | 'system';
  
  /** Content array */
  content?: Array<{
    type: 'text' | 'audio';
    text?: string;
    audio?: string; // Base64
    transcript?: string;
  }>;
  
  /** Function call details */
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

/**
 * Conversation item create event
 */
export interface ItemCreateEvent extends RealtimeEvent {
  type: 'conversation.item.create';
  
  /** Previous item ID */
  previous_item_id?: string;
  
  /** Item to create */
  item: ConversationItem;
}

/**
 * Response create event
 */
export interface ResponseCreateEvent extends RealtimeEvent {
  type: 'response.create';
  
  /** Response configuration */
  response?: {
    modalities?: string[];
    instructions?: string;
    voice?: string;
    output_audio_format?: string;
    tools?: ToolDefinition[];
    tool_choice?: string;
    temperature?: number;
    max_output_tokens?: number | 'inf';
  };
}

/**
 * Speech started event
 */
export interface SpeechStartedEvent extends RealtimeEvent {
  type: 'input_audio_buffer.speech_started';
  
  /** Audio start milliseconds */
  audio_start_ms: number;
  
  /** Item ID */
  item_id: string;
}

/**
 * Speech stopped event
 */
export interface SpeechStoppedEvent extends RealtimeEvent {
  type: 'input_audio_buffer.speech_stopped';
  
  /** Audio end milliseconds */
  audio_end_ms: number;
  
  /** Item ID if speech was committed */
  item_id?: string;
}

/**
 * Session created event
 */
export interface SessionCreatedEvent extends RealtimeEvent {
  type: 'session.created';
  
  /** Session details */
  session: {
    id: string;
    object: string;
    model: string;
    modalities: string[];
    instructions: string;
    voice: string;
    input_audio_format: string;
    output_audio_format: string;
    input_audio_transcription: any;
    turn_detection: any;
    tools: ToolDefinition[];
    tool_choice: string;
    temperature: number;
    max_response_output_tokens: number | 'inf';
  };
}

/**
 * Client event type map
 */
export type ClientEventMap = {
  'session.update': SessionConfigEvent;
  'input_audio_buffer.append': AudioAppendEvent;
  'input_audio_buffer.commit': AudioCommitEvent;
  'input_audio_buffer.clear': AudioClearEvent;
  'conversation.item.create': ItemCreateEvent;
  'response.create': ResponseCreateEvent;
  'response.cancel': RealtimeEvent;
};

/**
 * Server event type map
 */
export type ServerEventMap = {
  'error': ErrorEvent;
  'session.created': SessionCreatedEvent;
  'session.updated': RealtimeEvent;
  'rate_limits.updated': RateLimitEvent;
  'response.created': RealtimeEvent;
  'response.done': ResponseDoneEvent;
  'response.audio.delta': AudioDeltaEvent;
  'response.audio.done': AudioDoneEvent;
  'response.text.delta': TextDeltaEvent;
  'response.text.done': RealtimeEvent;
  'response.function_call_arguments.delta': FunctionCallDeltaEvent;
  'response.function_call_arguments.done': RealtimeEvent;
  'input_audio_buffer.speech_started': SpeechStartedEvent;
  'input_audio_buffer.speech_stopped': SpeechStoppedEvent;
  'conversation.item.created': RealtimeEvent;
  'conversation.item.input_audio_transcription.completed': TranscriptEvent;
  'conversation.item.input_audio_transcription.failed': TranscriptEvent;
};
