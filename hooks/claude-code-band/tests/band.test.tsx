import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'token-efficient-work-band',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

const usage = (usd: number) => ({
  value: { startedAt: 0, context: { window: 200_000, tokens: 50_000, percent: 25 }, rateLimits: [], cost: { usd } },
})

test('the band counts a repeated read and a read after an edit', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let costUsd = 1
  on('command.register', () => ({ value: { command: 'tew-band' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => usage(costUsd))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'fix the typo' })
  await $.tool.call({ tool: 'Grep', pattern: 'recieve' })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\repo\\mailer.py', offset: 10, limit: 5 })
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/mailer.py' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/mailer.py', old_string: 'recieve', new_string: 'receive' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/mailer.py' })
  costUsd = 1.25
  await $.turn.complete({
    answer: 'Fixed.',
    durationMs: 4_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'm', input_tokens: 100, output_tokens: 1_500, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /^tew/ })
  expect(row?.text).toBe(
    'tew · task $0.25 · 1.5k out · 5 tools · 3 reads (2 whole) · 1 repeated · 1 after an edit · session $1.25',
  )
  await ui.press({ key: 'hide' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('nothing is drawn before the first task', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
