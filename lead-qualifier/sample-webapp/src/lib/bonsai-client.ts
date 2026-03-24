export interface SessionSettings {
  sendVoiceInput: boolean
  sendTextInput: boolean
  receiveVoiceOutput: boolean
  receiveTranscriptionUpdates: boolean
  receiveEvents: boolean
}

export interface ProjectSettings {
  projectId: string
  acceptVoice: boolean
  generateVoice: boolean
  asrConfig: unknown
}

export interface AuthResponse {
  type: 'auth'
  requestId?: string
  success: boolean
  sessionId?: string
  projectSettings?: ProjectSettings
  error?: string
}

export interface StartConversationResponse {
  type: 'start_conversation'
  requestId?: string
  sessionId: string
  success: boolean
  conversationId?: string
  error?: string
}

export interface SendUserTextInputResponse {
  type: 'send_user_text_input'
  requestId?: string
  sessionId: string
  success: boolean
  inputTurnId?: string
  error?: string
}

export interface RunActionResponse {
  type: 'run_action'
  requestId?: string
  sessionId: string
  success: boolean
  result?: unknown
  error?: string
}

export interface StartAiGenerationOutputMessage {
  type: 'start_ai_generation_output'
  sessionId: string
  conversationId: string
  outputTurnId: string
  expectVoice: boolean
}

export interface AiTranscribedChunkMessage {
  type: 'ai_transcribed_chunk'
  sessionId: string
  conversationId: string
  outputTurnId: string
  chunkId: string
  chunkText: string
  ordinal: number
  isFinal: boolean
}

export interface EndAiGenerationOutputMessage {
  type: 'end_ai_generation_output'
  sessionId: string
  conversationId: string
  outputTurnId: string
  fullText: string
}

export interface ConversationEventMessage {
  type: 'conversation_event'
  sessionId: string
  conversationId: string
  eventType: string
  eventData: unknown
  inputTurnId?: string
  outputTurnId?: string
}

export interface ServerErrorMessage {
  type: 'error'
  requestId?: string
  error: string
}

type RequestResponseMessage =
  | AuthResponse
  | StartConversationResponse
  | SendUserTextInputResponse
  | RunActionResponse

type ServerMessage =
  | AuthResponse
  | StartConversationResponse
  | SendUserTextInputResponse
  | RunActionResponse
  | StartAiGenerationOutputMessage
  | AiTranscribedChunkMessage
  | EndAiGenerationOutputMessage
  | ConversationEventMessage
  | ServerErrorMessage

interface PendingRequest {
  resolve: (message: ServerMessage) => void
  reject: (error: Error) => void
  timeoutId: number
}

export interface ConversationStartOptions {
  userId: string
  stageId: string
  agentId?: string
  timezone?: string
}

export interface BonsaiClientHandlers {
  onConnect?: () => void
  onDisconnect?: (event: CloseEvent) => void
  onTransportError?: (error: Error) => void
  onServerError?: (message: ServerErrorMessage) => void
  onAiOutputStart?: (message: StartAiGenerationOutputMessage) => void
  onAiTranscribedChunk?: (message: AiTranscribedChunkMessage) => void
  onAiOutputEnd?: (message: EndAiGenerationOutputMessage) => void
  onConversationEvent?: (message: ConversationEventMessage) => void
}

export interface BonsaiClientConfig {
  apiBaseUrl: string
  apiKey: string
  timeoutMs?: number
  debug?: boolean
  sessionSettings?: Partial<SessionSettings>
  handlers?: BonsaiClientHandlers
}

const DEFAULT_SETTINGS: SessionSettings = {
  sendVoiceInput: false,
  sendTextInput: true,
  receiveVoiceOutput: false,
  receiveTranscriptionUpdates: true,
  receiveEvents: false,
}

function isRequestResponseMessage(message: ServerMessage): message is RequestResponseMessage {
  return (
    message.type === 'auth'
    || message.type === 'start_conversation'
    || message.type === 'send_user_text_input'
    || message.type === 'run_action'
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createWebSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl)
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  return `${protocol}//${url.host}/ws`
}

export class BonsaiTextClient {
  private readonly apiKey: string
  private readonly handlers: BonsaiClientHandlers
  private readonly timeoutMs: number
  private readonly debug: boolean
  private readonly sessionSettings: SessionSettings
  private readonly wsUrl: string
  private readonly pendingRequests = new Map<string, PendingRequest>()

  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private conversationId: string | null = null
  private projectSettings: ProjectSettings | null = null

  constructor(config: BonsaiClientConfig) {
    this.apiKey = config.apiKey.trim()
    this.handlers = config.handlers ?? {}
    this.timeoutMs = config.timeoutMs ?? 20_000
    this.debug = config.debug ?? false
    this.sessionSettings = {
      ...DEFAULT_SETTINGS,
      ...config.sessionSettings,
    }
    this.wsUrl = createWebSocketUrl(config.apiBaseUrl.trim())
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  getConversationId(): string | null {
    return this.conversationId
  }

  getProjectSettings(): ProjectSettings | null {
    return this.projectSettings
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      let didSettle = false

      this.ws = new WebSocket(this.wsUrl)

      this.ws.onopen = async () => {
        this.log('WebSocket open')
        this.handlers.onConnect?.()

        try {
          const authResponse = await this.sendRequest<AuthResponse>({
            type: 'auth',
            apiKey: this.apiKey,
            sessionSettings: this.sessionSettings,
          })

          if (!authResponse.success || !authResponse.sessionId) {
            throw new Error(authResponse.error || 'Authentication failed')
          }

          this.sessionId = authResponse.sessionId
          this.projectSettings = authResponse.projectSettings ?? null

          if (!didSettle) {
            didSettle = true
            resolve()
          }
        } catch (error) {
          const message = toErrorMessage(error)
          this.log('Authentication failed', message)

          if (!didSettle) {
            didSettle = true
            reject(new Error(message))
          }

          this.disconnect()
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as ServerMessage
          this.handleMessage(parsed)
        } catch (error) {
          this.log('Failed to parse message', error)
        }
      }

      this.ws.onerror = () => {
        const error = new Error('WebSocket transport error')
        this.handlers.onTransportError?.(error)

        if (!didSettle) {
          didSettle = true
          reject(error)
        }
      }

      this.ws.onclose = (event) => {
        this.log('WebSocket close', event.code, event.reason)
        this.rejectPendingRequests(new Error(event.reason || 'Connection closed'))
        this.resetState()
        this.handlers.onDisconnect?.(event)

        if (!didSettle) {
          didSettle = true
          reject(new Error(event.reason || 'Connection closed'))
        }
      }
    })
  }

  async startConversation(options: ConversationStartOptions): Promise<string> {
    const sessionId = this.requireSessionId()

    const response = await this.sendRequest<StartConversationResponse>({
      type: 'start_conversation',
      sessionId,
      userId: options.userId,
      stageId: options.stageId,
      agentId: options.agentId,
      timezone: options.timezone,
    })

    if (!response.success || !response.conversationId) {
      throw new Error(response.error || 'Failed to start conversation')
    }

    this.conversationId = response.conversationId

    return response.conversationId
  }

  async sendTextInput(text: string): Promise<void> {
    const { sessionId, conversationId } = this.requireConversation()

    const response = await this.sendRequest<SendUserTextInputResponse>({
      type: 'send_user_text_input',
      sessionId,
      conversationId,
      text,
    })

    if (!response.success) {
      throw new Error(response.error || 'Failed to send text input')
    }
  }

  async runAction(actionName: string, parameters: Record<string, unknown>): Promise<unknown> {
    const { sessionId, conversationId } = this.requireConversation()

    const response = await this.sendRequest<RunActionResponse>({
      type: 'run_action',
      sessionId,
      conversationId,
      actionName,
      parameters,
    })

    if (!response.success) {
      throw new Error(response.error || `Failed to run action ${actionName}`)
    }

    return response.result
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
    }

    this.rejectPendingRequests(new Error('Disconnected'))
    this.resetState()
  }

  private async sendRequest<T extends ServerMessage>(payload: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }

    const requestId = this.generateId('req')
    const message = {
      requestId,
      ...payload,
    }

    const promise = new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Request timed out: ${String(payload.type)}`))
      }, this.timeoutMs)

      this.pendingRequests.set(requestId, {
        resolve: (response) => resolve(response as T),
        reject,
        timeoutId,
      })
    })

    this.ws.send(JSON.stringify(message))
    this.log('Sent', message)

    return promise
  }

  private handleMessage(message: ServerMessage): void {
    this.log('Received', message)

    if (message.type === 'error') {
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        const pending = this.pendingRequests.get(message.requestId)
        if (pending) {
          window.clearTimeout(pending.timeoutId)
          this.pendingRequests.delete(message.requestId)
          pending.reject(new Error(message.error))
          return
        }
      }

      this.handlers.onServerError?.(message)
      return
    }

    if (isRequestResponseMessage(message) && message.requestId) {
      const pending = this.pendingRequests.get(message.requestId)

      if (pending) {
        window.clearTimeout(pending.timeoutId)
        this.pendingRequests.delete(message.requestId)
        pending.resolve(message)
        return
      }
    }

    switch (message.type) {
      case 'start_ai_generation_output':
        this.handlers.onAiOutputStart?.(message)
        break
      case 'ai_transcribed_chunk':
        this.handlers.onAiTranscribedChunk?.(message)
        break
      case 'end_ai_generation_output':
        this.handlers.onAiOutputEnd?.(message)
        break
      case 'conversation_event':
        this.handlers.onConversationEvent?.(message)
        break
      default:
        break
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      window.clearTimeout(pending.timeoutId)
      pending.reject(error)
      this.pendingRequests.delete(requestId)
    }
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error('No authenticated session')
    }

    return this.sessionId
  }

  private requireConversation(): { sessionId: string; conversationId: string } {
    const sessionId = this.requireSessionId()

    if (!this.conversationId) {
      throw new Error('No active conversation')
    }

    return {
      sessionId,
      conversationId: this.conversationId,
    }
  }

  private resetState(): void {
    this.ws = null
    this.sessionId = null
    this.conversationId = null
    this.projectSettings = null
  }

  private generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `${prefix}_${crypto.randomUUID()}`
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }

  private log(...args: unknown[]): void {
    if (!this.debug) {
      return
    }

    console.log('[bonsai-client]', ...args)
  }
}
