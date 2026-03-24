<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'

import {
  BonsaiTextClient,
  type AiTranscribedChunkMessage,
  type ConversationEventMessage,
  type EndAiGenerationOutputMessage,
  type StartAiGenerationOutputMessage,
} from './lib/bonsai-client'
import { loadRuntimeConfig } from './lib/config'
import {
  buildInitialActionPayload,
  buildLeadUserId,
  getBrowserTimezone,
  loadLeadProfile,
  persistLeadProfile,
  validateWorkEmail,
  type LeadProfile,
} from './lib/lead'

type ExperiencePhase = 'intake' | 'activating' | 'chat'
type ConnectionState = 'idle' | 'connecting' | 'live' | 'error' | 'disconnected'
type MessageRole = 'assistant' | 'user'
type ChatMessageKind = 'message' | 'director-thoughts' | 'director-red-flags'
type ConversationTerminalState = 'finished' | 'aborted' | 'failed'

interface ChatMessage {
  id: string
  kind: ChatMessageKind
  role?: MessageRole
  title?: string
  text: string
  timestamp: string
  isStreaming?: boolean
}

interface TransformationEventMetadata {
  transformerName?: string
  updatedVariables?: Record<string, unknown>
}

interface TransformationEventData {
  transformerId?: string
  input?: string
  appliedFields?: unknown
  metadata?: TransformationEventMetadata
}

const DIRECTOR_TRANSFORMER_NAME = 'Director Whisper - Lead Qualifier'

const runtimeConfig = loadRuntimeConfig()
const lead = reactive<LeadProfile>(loadLeadProfile())

const phase = ref<ExperiencePhase>('intake')
const connectionState = ref<ConnectionState>('idle')
const runtimeError = ref<string | null>(null)
const isStarting = ref(false)
const isSending = ref(false)
const isInitialActionInFlight = ref(false)
const initialActionCompleted = ref(false)
const initialActionRetryQueued = ref(false)
const conversationTerminalState = ref<ConversationTerminalState | null>(null)
const composerValue = ref('')
const messages = ref<ChatMessage[]>([])
const messagesViewport = ref<HTMLElement | null>(null)
const client = shallowRef<BonsaiTextClient | null>(null)
const conversationId = ref('')
const userId = ref('')

const streamingMessageIds = new Map<string, string>()
const streamingBuffers = new Map<string, string>()

watch(
  () => [lead.name, lead.email, lead.company],
  () => {
    persistLeadProfile(lead)
  },
  { immediate: true },
)

const configIssues = computed(() => {
  const issues: string[] = []

  if (!runtimeConfig.apiBaseUrl) {
    issues.push('The Bonsai backend URL is missing in the frontend env configuration.')
  }

  if (!runtimeConfig.apiKey) {
    issues.push('The project API key is missing in the frontend env configuration.')
  }

  if (!runtimeConfig.projectId) {
    issues.push('The project ID is missing in the frontend env configuration.')
  }

  if (!runtimeConfig.entryStageId) {
    issues.push('The entry stage ID is missing in the frontend env configuration.')
  }

  if (!runtimeConfig.initialActionName) {
    issues.push('The initial Bonsai action name is missing in the frontend env configuration.')
  }

  return issues
})

const intakeErrors = computed(() => {
  const errors: string[] = []

  if (!lead.name.trim()) {
    errors.push('Name is required.')
  }

  if (!validateWorkEmail(lead.email)) {
    errors.push('Use a valid work email address.')
  }

  if (!lead.company.trim()) {
    errors.push('Company name is required.')
  }

  return errors
})

const canStart = computed(() =>
  !isStarting.value
  && intakeErrors.value.length === 0
  && configIssues.value.length === 0,
)

const canSend = computed(() =>
  phase.value === 'chat'
  && connectionState.value === 'live'
  && conversationTerminalState.value === null
  && Boolean(composerValue.value.trim())
  && !isSending.value,
)

const userLabel = computed(() => lead.name.trim() || 'You')
const showIdleStartPane = computed(() =>
  phase.value === 'intake'
  && connectionState.value === 'idle'
  && !runtimeError.value
  && messages.value.length === 0,
)
const hasConversationSession = computed(() =>
  Boolean(conversationId.value)
  || phase.value === 'chat'
  || messages.value.length > 0
  || conversationTerminalState.value !== null,
)

const statusPillState = computed(() => {
  if (conversationTerminalState.value === 'failed') {
    return 'error'
  }

  if (conversationTerminalState.value === 'finished' || conversationTerminalState.value === 'aborted') {
    return 'finished'
  }

  return connectionState.value
})

const statusLabel = computed(() => {
  if (conversationTerminalState.value === 'finished') {
    return 'Finished'
  }

  if (conversationTerminalState.value === 'aborted') {
    return 'Ended'
  }

  if (conversationTerminalState.value === 'failed') {
    return 'Failed'
  }

  switch (connectionState.value) {
    case 'connecting':
      return 'Connecting'
    case 'live':
      return 'Live'
    case 'error':
      return 'Error'
    case 'disconnected':
      return 'Disconnected'
    default:
      return 'Ready'
  }
})

const startButtonLabel = computed(() => {
  if (isStarting.value) {
    return 'Opening Alex…'
  }

  return 'Start'
})

const formActionLabel = computed(() => {
  if (isStarting.value) {
    return 'Opening Alex…'
  }

  return hasConversationSession.value ? 'Restart' : 'Start'
})

const emptyChatText = computed(() => {
  if (phase.value === 'activating' || connectionState.value === 'connecting') {
    return 'Opening the conversation with Alex.'
  }

  if (runtimeError.value) {
    return 'Fix the issue on the left, then start again.'
  }

  if (!lead.name.trim() || !lead.email.trim() || !lead.company.trim()) {
    return 'Fill in your details on the left to unlock the conversation.'
  }

  if (connectionState.value === 'live') {
    return 'Alex is connected. Send your first message when you are ready.'
  }

  return 'Start the qualifier to begin the conversation.'
})

const composerPlaceholder = computed(() => {
  if (conversationTerminalState.value === 'finished' || conversationTerminalState.value === 'aborted') {
    return 'Conversation finished. Restart to begin again.'
  }

  if (conversationTerminalState.value === 'failed') {
    return 'Conversation failed. Restart to try again.'
  }

  return 'Tell Alex what you are trying to qualify, book, or understand.'
})

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function currentTimestamp(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function pushMessage(role: MessageRole, text: string, options?: { isStreaming?: boolean }): string {
  const id = generateId('msg')

  messages.value.push({
    kind: 'message',
    id,
    role,
    text,
    timestamp: currentTimestamp(),
    isStreaming: options?.isStreaming,
  })

  void scrollChatToBottom()
  return id
}

function pushDirectorMessage(kind: Extract<ChatMessageKind, 'director-thoughts' | 'director-red-flags'>, title: string, text: string): string {
  const id = generateId('msg')

  messages.value.push({
    kind,
    id,
    title,
    text,
    timestamp: currentTimestamp(),
  })

  void scrollChatToBottom()
  return id
}

function updateMessage(id: string, patch: Partial<ChatMessage>): void {
  const index = messages.value.findIndex((message) => message.id === id)
  if (index === -1) {
    return
  }

  messages.value[index] = {
    ...messages.value[index],
    ...patch,
  }

  void scrollChatToBottom()
}

async function scrollChatToBottom(): Promise<void> {
  await nextTick()

  if (messagesViewport.value) {
    messagesViewport.value.scrollTop = messagesViewport.value.scrollHeight
  }
}

function destroyClient(): void {
  client.value?.disconnect()
  client.value = null
  conversationId.value = ''
}

function resetConversationState(): void {
  phase.value = 'intake'
  connectionState.value = 'idle'
  runtimeError.value = null
  isStarting.value = false
  isSending.value = false
  isInitialActionInFlight.value = false
  initialActionCompleted.value = false
  initialActionRetryQueued.value = false
  conversationTerminalState.value = null
  composerValue.value = ''
  messages.value = []
  streamingMessageIds.clear()
  streamingBuffers.clear()
  conversationId.value = ''
  userId.value = ''
}

function explainError(rawMessage: string): string {
  if (/stage not found/i.test(rawMessage)) {
    return 'The configured entry stage was rejected by Bonsai.'
  }

  if (/user with id .* not found/i.test(rawMessage)) {
    return 'This Bonsai project appears to have autoCreateUsers disabled for new leads.'
  }

  if (/authentication failed|invalid api key|invalid or inactive api key/i.test(rawMessage)) {
    return 'The configured project API key was rejected by Bonsai.'
  }

  if (/cannot run action in current state/i.test(rawMessage)) {
    return 'Alex is still finishing the opening turn.'
  }

  return rawMessage
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function humanizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function indentBlock(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
}

function formatDirectorValue(value: unknown): string {
  if (value == null) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatDirectorValue(item))
      .filter(Boolean)
      .map((item) => `• ${item.replace(/\n/g, '\n  ')}`)
      .join('\n')
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const formatted = formatDirectorValue(nestedValue)
        if (!formatted) {
          return ''
        }

        if (formatted.includes('\n')) {
          return `${humanizeKey(key)}:\n${indentBlock(formatted)}`
        }

        return `${humanizeKey(key)}: ${formatted}`
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function parseTransformationEventData(eventData: unknown): TransformationEventData | null {
  if (!eventData || typeof eventData !== 'object') {
    return null
  }

  return eventData as TransformationEventData
}

function getConversationEventReason(eventData: unknown): string | null {
  if (!eventData || typeof eventData !== 'object') {
    return null
  }

  const reason = (eventData as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null
}

function handleConversationEvent(message: ConversationEventMessage): void {
  if (message.eventType === 'conversation_end') {
    conversationTerminalState.value = 'finished'
    composerValue.value = ''
    isSending.value = false
    return
  }

  if (message.eventType === 'conversation_aborted') {
    conversationTerminalState.value = 'aborted'
    composerValue.value = ''
    isSending.value = false
    return
  }

  if (message.eventType === 'conversation_failed') {
    conversationTerminalState.value = 'failed'
    composerValue.value = ''
    isSending.value = false

    const reason = getConversationEventReason(message.eventData)
    if (reason) {
      runtimeError.value = reason
    }

    return
  }

  if (message.eventType !== 'transformation') {
    return
  }

  const eventData = parseTransformationEventData(message.eventData)
  if (!eventData) {
    return
  }

  const transformerName = eventData.metadata?.transformerName
  if (transformerName !== DIRECTOR_TRANSFORMER_NAME) {
    return
  }

  const appliedFields = Array.isArray(eventData.appliedFields)
    ? eventData.appliedFields.filter((value): value is string => typeof value === 'string')
    : []
  const updatedVariables = eventData.metadata?.updatedVariables ?? {}

  if (appliedFields.includes('inner_reflect')) {
    const thoughts = formatDirectorValue(updatedVariables.inner_reflect)
    if (isNonEmptyString(thoughts)) {
      pushDirectorMessage('director-thoughts', 'Director Thoughts', thoughts)
    }
  }

  if (appliedFields.includes('red_flags')) {
    const redFlags = formatDirectorValue(updatedVariables.red_flags)
    if (isNonEmptyString(redFlags)) {
      pushDirectorMessage('director-red-flags', 'Director Red Flags', redFlags)
    }
  }
}

async function triggerInitialAction(mode: 'initial' | 'retry'): Promise<void> {
  if (!client.value || initialActionCompleted.value || isInitialActionInFlight.value) {
    return
  }

  isInitialActionInFlight.value = true

  try {
    await client.value.runAction(
      runtimeConfig.initialActionName,
      buildInitialActionPayload(lead, runtimeConfig.projectId),
    )

    initialActionCompleted.value = true
  } catch (error) {
    const message = explainError(error instanceof Error ? error.message : String(error))

    if (/still finishing the opening turn/i.test(message) && mode === 'initial') {
      initialActionRetryQueued.value = true
      return
    }

    runtimeError.value = `Lead handoff failed: ${message}`
  } finally {
    isInitialActionInFlight.value = false
  }
}

function handleAiOutputStart(message: StartAiGenerationOutputMessage): void {
  const messageId = pushMessage('assistant', '', { isStreaming: true })

  streamingMessageIds.set(message.outputTurnId, messageId)
  streamingBuffers.set(message.outputTurnId, '')
}

function handleAiTranscribedChunk(message: AiTranscribedChunkMessage): void {
  const existingId = streamingMessageIds.get(message.outputTurnId)
    ?? pushMessage('assistant', '', { isStreaming: true })

  streamingMessageIds.set(message.outputTurnId, existingId)

  const nextValue = `${streamingBuffers.get(message.outputTurnId) ?? ''}${message.chunkText}`
  streamingBuffers.set(message.outputTurnId, nextValue)

  updateMessage(existingId, {
    text: nextValue,
    isStreaming: !message.isFinal,
  })
}

function handleAiOutputEnd(message: EndAiGenerationOutputMessage): void {
  const existingId = streamingMessageIds.get(message.outputTurnId)
    ?? pushMessage('assistant', '', { isStreaming: false })
  const fullText = message.fullText.trim() || streamingBuffers.get(message.outputTurnId)?.trim() || ''

  updateMessage(existingId, {
    text: fullText || '…',
    isStreaming: false,
  })

  streamingMessageIds.delete(message.outputTurnId)
  streamingBuffers.delete(message.outputTurnId)

  if (initialActionRetryQueued.value && !initialActionCompleted.value) {
    initialActionRetryQueued.value = false
    window.setTimeout(() => {
      void triggerInitialAction('retry')
    }, 150)
  }
}

async function startSession(): Promise<void> {
  if (!canStart.value) {
    return
  }

  destroyClient()
  resetConversationState()

  phase.value = 'activating'
  connectionState.value = 'connecting'
  isStarting.value = true
  userId.value = buildLeadUserId(lead.email)

  const nextClient = new BonsaiTextClient({
    apiBaseUrl: runtimeConfig.apiBaseUrl,
    apiKey: runtimeConfig.apiKey,
    sessionSettings: {
      receiveEvents: true,
    },
    handlers: {
      onDisconnect: () => {
        if (client.value !== nextClient) {
          return
        }

        connectionState.value = 'disconnected'
      },
      onServerError: (message) => {
        if (client.value !== nextClient) {
          return
        }

        runtimeError.value = explainError(message.error)
      },
      onTransportError: (error) => {
        if (client.value !== nextClient) {
          return
        }

        runtimeError.value = explainError(error.message)
      },
      onAiOutputStart: (message) => {
        if (client.value !== nextClient) {
          return
        }

        handleAiOutputStart(message)
      },
      onAiTranscribedChunk: (message) => {
        if (client.value !== nextClient) {
          return
        }

        handleAiTranscribedChunk(message)
      },
      onAiOutputEnd: (message) => {
        if (client.value !== nextClient) {
          return
        }

        handleAiOutputEnd(message)
      },
      onConversationEvent: (message) => {
        if (client.value !== nextClient) {
          return
        }

        handleConversationEvent(message)
      },
    },
  })

  client.value = nextClient

  try {
    await nextClient.connect()

    if (client.value !== nextClient) {
      return
    }

    connectionState.value = 'live'
    conversationId.value = await nextClient.startConversation({
      userId: userId.value,
      stageId: runtimeConfig.entryStageId,
      timezone: getBrowserTimezone(),
    })

    if (client.value !== nextClient) {
      return
    }

    phase.value = 'chat'
    await triggerInitialAction('initial')
  } catch (error) {
    if (client.value === nextClient) {
      runtimeError.value = explainError(error instanceof Error ? error.message : String(error))
      connectionState.value = 'error'
    }

    destroyClient()
    phase.value = 'intake'
  } finally {
    isStarting.value = false
  }
}

async function sendMessage(): Promise<void> {
  if (!canSend.value || !client.value) {
    return
  }

  const text = composerValue.value.trim()
  composerValue.value = ''
  pushMessage('user', text)
  isSending.value = true

  try {
    await client.value.sendTextInput(text)
  } catch (error) {
    runtimeError.value = explainError(error instanceof Error ? error.message : String(error))
  } finally {
    isSending.value = false
  }
}

onBeforeUnmount(() => {
  destroyClient()
})
</script>

<template>
  <div class="shell">
    <div class="ambient ambient-a"></div>
    <div class="ambient ambient-b"></div>
    <div class="ambient ambient-c"></div>

    <main class="layout">
      <section class="hero-panel">
        <p class="eyebrow">Bonsai / Lead Qualifier</p>
        <h1 class="hero-title">Capture human signal, qualify the lead.</h1>
        <p class="hero-copy">
          Use this application to test the example use case of a Bonsai Lead Qualifier Assistant
        </p>

        <form
          class="lead-form"
          @submit.prevent
        >
          <label class="field">
            <span>Name</span>
            <input
              v-model="lead.name"
              autocomplete="name"
              name="name"
              placeholder="Ada Lovelace"
              type="text"
            />
          </label>

          <label class="field">
            <span>Work email</span>
            <input
              v-model="lead.email"
              autocomplete="email"
              inputmode="email"
              name="email"
              placeholder="ada@analytical.engine"
              type="email"
            />
          </label>

          <label class="field">
            <span>Company</span>
            <input
              v-model="lead.company"
              autocomplete="organization"
              name="company"
              placeholder="Analytical Engine Ltd"
              type="text"
            />
          </label>

          <p class="persistence-note">Saved in this browser on this device.</p>

          <div
            v-if="intakeErrors.length"
            class="notice notice-warn"
          >
            <p
              v-for="item in intakeErrors"
              :key="item"
            >
              {{ item }}
            </p>
          </div>

          <div
            v-if="configIssues.length"
            class="notice notice-warn"
          >
            <p
              v-for="item in configIssues"
              :key="item"
            >
              {{ item }}
            </p>
          </div>

          <button
            class="primary-button form-action"
            :disabled="!canStart"
            type="button"
            @click="startSession"
          >
            {{ formActionLabel }}
          </button>
        </form>
      </section>

      <section
        class="surface chat-surface"
        :class="{ 'chat-surface-idle': showIdleStartPane }"
      >
        <div
          v-if="showIdleStartPane"
          class="chat-start-shell"
        >
          <button
            class="primary-button chat-start-button"
            :disabled="!canStart"
            type="button"
            @click="startSession"
          >
            {{ startButtonLabel }}
          </button>
        </div>

        <template v-else>
          <div class="chat-header">
            <div>
              <p class="surface-kicker">Conversation</p>
              <h2>Alex</h2>
              <p class="chat-subtitle">Lead qualifier assistant</p>
            </div>

            <span
              class="status-pill"
              :data-state="statusPillState"
            >
              {{ statusLabel }}
            </span>
          </div>

          <div
            v-if="runtimeError"
            class="notice notice-warn"
          >
            {{ runtimeError }}
          </div>

          <div
            ref="messagesViewport"
            class="messages"
          >
            <article
              v-for="message in messages"
              :key="message.id"
              class="message"
              :data-kind="message.kind"
              :data-role="message.role"
            >
              <header class="message-meta">
                <span>
                  {{
                    message.kind === 'message'
                      ? (message.role === 'assistant' ? 'Alex' : userLabel)
                      : message.title
                  }}
                </span>
                <span>{{ message.timestamp }}</span>
              </header>
              <p class="message-body">
                {{ message.text || (message.isStreaming ? '…' : '') }}
              </p>
            </article>

            <article
              v-if="!messages.length"
              class="empty-state"
            >
              <p>{{ emptyChatText }}</p>
            </article>
          </div>

          <form
            class="composer"
            @submit.prevent="sendMessage"
          >
            <input
              class="composer-input"
              v-model="composerValue"
              :disabled="connectionState !== 'live' || conversationTerminalState !== null"
              autocomplete="off"
              :placeholder="composerPlaceholder"
              type="text"
            />

            <button
              class="primary-button composer-submit"
              :disabled="!canSend"
              type="submit"
            >
              {{ isSending ? 'Sending…' : 'Send' }}
            </button>
          </form>
        </template>
      </section>
    </main>
  </div>
</template>
