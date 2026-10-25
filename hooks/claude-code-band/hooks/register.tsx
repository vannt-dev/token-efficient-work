import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Counts, Session, Task } from '../types'

const PLUGIN = 'token-efficient-work-band'
const COMMAND = 'tew-band'
const HIDDEN_KEY = 'isHidden'

const ZERO: Counts = {
  toolCalls: 0,
  reads: 0,
  wholeReads: 0,
  repeatReads: 0,
  readsAfterEdit: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
}
const NEW_SESSION: Session = { ...ZERO, tasks: 0, costUsd: 0, contextPercent: null }

// Change a tag when the fields of its value change: an older value is then read as the initial one.
const task = atom({ plugin: 'token-efficient-work-band', key: 'task' } as const, null, { shape: 'task-1' })
const session = atom({ plugin: 'token-efficient-work-band', key: 'session' } as const, NEW_SESSION, {
  shape: 'session-1',
})
const isHidden = atom({ plugin: 'token-efficient-work-band', key: 'isHidden' } as const, false)
const isDetailed = atom({ plugin: 'token-efficient-work-band', key: 'isDetailed' } as const, false)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

function pathOf(e: { file_path?: unknown; notebook_path?: unknown }): string | null {
  const raw = typeof e.file_path === 'string' ? e.file_path : e.notebook_path
  return typeof raw === 'string' ? raw.replace(/\\/g, '/').toLowerCase() : null
}

function add(counts: Counts, more: Partial<Counts>): Counts {
  const next = { ...counts }
  for (const [name, value] of Object.entries(more) as [keyof Counts, number][]) {
    next[name] = counts[name] + value
  }
  return next
}

async function count($: EngineInterface, more: Partial<Counts>): Promise<void> {
  await update($, task, current => (current ? { ...current, ...add(current, more) } : current))
  await update($, session, current => ({ ...current, ...add(current, more) }))
}

export function usd(value: number): string {
  return value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(1)}`
}

export function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function reads(counts: Counts): string {
  const parts = [`${counts.reads} reads`]
  if (counts.wholeReads > 0) parts[0] += ` (${counts.wholeReads} whole)`
  if (counts.repeatReads > 0) parts.push(`${counts.repeatReads} repeated`)
  if (counts.readsAfterEdit > 0) parts.push(`${counts.readsAfterEdit} after an edit`)
  return parts.join(' · ')
}

export const register: Register = on => {
  // What this task has read and edited, by path. A reload starts these over; the counts stay.
  let readPaths = new Set<string>()
  let editedPaths = new Set<string>()


  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the token-efficient-work band: tew-band [on|off|details]',
    })
    const stored = await $.store.get(HIDDEN_KEY)
    if (typeof stored === 'boolean') await update($, isHidden, () => stored)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'details') {
      const value = await update($, isDetailed, current => !current)
      return { text: value ? 'Band shows details.' : 'Band shows one line.' }
    }
    const hidden =
      word === 'off' ? true : word === 'on' ? false : !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    await $.store.set(HIDDEN_KEY, hidden)
    return { text: hidden ? 'Band hidden. /tew-band shows it again.' : 'Band shown.' }
  })

  on('prompt.submit', async ($, e, next) => {
    readPaths = new Set()
    editedPaths = new Set()
    const usage = await $.session.usage()
    const startCostUsd = usage.cost?.usd ?? 0
    const fresh: Task = {
      ...ZERO,
      isRunning: true,
      startedAt: await $.clock.now(),
      durationMs: 0,
      startCostUsd,
      costUsd: 0,
    }
    await update($, task, () => fresh)
    await update($, session, current => ({ ...current, tasks: current.tasks + 1 }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const path = pathOf(e as { file_path?: unknown; notebook_path?: unknown })
    if (e.tool === 'Read' && path) {
      const input = e as { offset?: unknown; limit?: unknown }
      const isWhole = input.offset === undefined && input.limit === undefined
      const afterEdit = editedPaths.has(path)
      const repeat = !afterEdit && readPaths.has(path)
      editedPaths.delete(path)
      readPaths.add(path)
      await count($, {
        toolCalls: 1,
        reads: 1,
        wholeReads: isWhole ? 1 : 0,
        repeatReads: repeat ? 1 : 0,
        readsAfterEdit: afterEdit ? 1 : 0,
      })
      return next(e)
    }
    await count($, { toolCalls: 1 })
    const ran = await next(e)
    if (EDIT_TOOLS.has(e.tool) && path && ran.deny === undefined && ran.isError !== true) {
      editedPaths.add(path)
      readPaths.delete(path)
    }
    return ran
  })

  on('session.measure', async ($, e, next) => {
    const costUsd = e.cost?.usd
    const contextPercent = e.context.percent ?? null
    await update($, session, current => ({
      ...current,
      costUsd: costUsd ?? current.costUsd,
      contextPercent,
    }))
    if (costUsd !== undefined) {
      await update($, task, current =>
        current?.isRunning ? { ...current, costUsd: costUsd - current.startCostUsd } : current,
      )
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    if (usage) {
      await count($, {
        inputTokens:
          usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        cachedTokens: usage.cache_read_input_tokens,
        outputTokens: usage.output_tokens,
      })
    }
    if (e.agentId === undefined) {
      const final = (await $.session.usage()).cost?.usd
      if (final !== undefined) await update($, session, current => ({ ...current, costUsd: final }))
      await update($, task, current =>
        current
          ? {
              ...current,
              isRunning: false,
              durationMs: e.durationMs,
              costUsd: final === undefined ? current.costUsd : final - current.startCostUsd,
            }
          : current,
      )
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, task)
    if (e.props.hasSurvey || current === null || (await read($, isHidden))) return next(e)

    const total = await read($, session)
    const detailed = await read($, isDetailed)
    const { Box, Button, Text } = $.ui.resolve(e)
    const elapsed = current.isRunning
      ? `running ${duration((await $.clock.now()) - current.startedAt)}`
      : duration(current.durationMs)
    const context = total.contextPercent === null ? '' : ` · context ${total.contextPercent}%`
    const buttons = (
      <Box>
        <Button
          key="details"
          label={detailed ? 'One line' : 'Details'}
          onPress={() => update($, isDetailed, value => !value)}
        />
        <Button
          key="hide"
          label="Hide"
          onPress={async () => {
            await update($, isHidden, () => true)
            await $.store.set(HIDDEN_KEY, true)
          }}
        />
      </Box>
    )

    if (!detailed) {
      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            tew · task {usd(current.costUsd)} · {tokens(current.outputTokens)} out ·{' '}
            {current.toolCalls} tools · {reads(current)} · session {usd(total.costUsd)}
            {context}
          </Text>
          {buttons}
        </Box>
      )
    }

    const cachedShare = (counts: { inputTokens: number; cachedTokens: number }) =>
      counts.inputTokens === 0 ? 0 : Math.round((counts.cachedTokens / counts.inputTokens) * 100)
    return (
      <Box flexDirection="column">
        <Text dimColor>
          Task ({elapsed}): {usd(current.costUsd)} · {tokens(current.inputTokens)} in (
          {cachedShare(current)}% cached), {tokens(current.outputTokens)} out ·{' '}
          {current.toolCalls} tool calls · {reads(current)}
        </Text>
        <Text dimColor>
          Session: {usd(total.costUsd)} · {total.tasks} tasks · {tokens(total.inputTokens)} in (
          {cachedShare(total)}% cached), {tokens(total.outputTokens)} out · {reads(total)}
          {context}
        </Text>
        {buttons}
      </Box>
    )
  })
}
