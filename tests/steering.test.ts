import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  DIRECTIVE_TEXT,
  installSection,
  installTurnReminder,
  REMINDER_SECTION_NAME,
  SECTION_NAME,
} from '../src/steering.js'

function fakeContext(): { ctx: Context; section: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } {
  const section = vi.fn(() => () => {})
  const on = vi.fn()
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    on,
    systemPrompt: { section },
  } as unknown as Context
  return { ctx, section, on }
}

describe('steering directive', () => {
  it('names the reasoning channel and Simplified Chinese', () => {
    expect(DIRECTIVE_TEXT).toContain('简体中文')
    expect(DIRECTIVE_TEXT).toContain('思考（reasoning）')
  })
})

describe('installSection', () => {
  it('registers an order-10 section with the directive text', () => {
    const { ctx, section } = fakeContext()
    installSection(ctx)
    expect(section).toHaveBeenCalledTimes(1)
    expect(section).toHaveBeenCalledWith({
      name: SECTION_NAME,
      order: 10,
      text: DIRECTIVE_TEXT,
    })
    expect(SECTION_NAME).toBe('reasoning-cn:directive')
  })
})

describe('installTurnReminder', () => {
  type Handler = (payload: { step: number; signal: AbortSignal }, next: () => Promise<unknown>) => Promise<{ kind: string; messages: unknown[] }>

  function installedHandler(): Handler {
    const { ctx, on } = fakeContext()
    installTurnReminder(ctx, 'dsh-reasoning-cn')
    expect(on).toHaveBeenCalledTimes(1)
    const [event, handler, options] = on.mock.calls[0] as unknown as [string, Handler, { prepend: boolean }]
    expect(event).toBe('agent/pre-step')
    expect(options).toEqual({ prepend: true })
    return handler
  }

  it('appends a snapshot-source reminder message at step 1', async () => {
    const handler = installedHandler()
    const existing = { placeholder: true }
    const decision = await handler({ step: 1, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages: [existing] }))

    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[0]).toBe(existing)
    const reminder = decision.messages[1] as unknown as {
      content: Array<{ type: string; text: string }>
      source: { kind: string; plugin: string; form: string; sections: Array<{ name: string; text: string }> }
    }
    expect(reminder.content[0].type).toBe('text')
    expect(reminder.content[0].text).toBe(`<system-reminder>\n${DIRECTIVE_TEXT}\n</system-reminder>`)
    expect(reminder.source).toEqual({
      kind: 'plugin',
      plugin: 'dsh-reasoning-cn',
      form: 'snapshot',
      sections: [{ name: REMINDER_SECTION_NAME, text: DIRECTIVE_TEXT }],
    })
  })

  it('leaves later steps untouched', async () => {
    const handler = installedHandler()
    const original = { kind: 'enter', messages: [{ id: 1 }] }
    const decision = await handler({ step: 2, signal: new AbortController().signal }, () => Promise.resolve(original))
    expect(decision).toBe(original as never)
  })

  it('leaves rejected decisions untouched', async () => {
    const handler = installedHandler()
    const original = { kind: 'reject' }
    const decision = await handler({ step: 1, signal: new AbortController().signal }, () => Promise.resolve(original))
    expect(decision).toBe(original as never)
  })

  it('leaves the decision untouched when the signal already aborted', async () => {
    const handler = installedHandler()
    const controller = new AbortController()
    controller.abort()
    const original = { kind: 'enter', messages: [] }
    const decision = await handler({ step: 1, signal: controller.signal }, () => Promise.resolve(original))
    expect(decision).toBe(original as never)
  })
})
