export type Counts = {
  toolCalls: number
  reads: number
  wholeReads: number
  repeatReads: number
  readsAfterEdit: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
}

export type Task = Counts & {
  isRunning: boolean
  startedAt: number
  durationMs: number
  startCostUsd: number
  costUsd: number
}

export type Session = Counts & {
  tasks: number
  costUsd: number
  contextPercent: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-efficient-work-band': {
      task: Shaped<Task | null>
      session: Shaped<Session>
      isHidden: boolean
      isDetailed: boolean
    }
  }
}
