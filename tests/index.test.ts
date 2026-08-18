import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply, Config as PluginConfig } from '../src/index.js'
import type { Config, SteeringMode } from '../src/index.js'

const config: Config = {
  steering: 'both',
  translate: true,
  translateProvider: 'test-provider',
  translateModel: 'test-model',
  translateThinkingOff: true,
  cjkThreshold: 0.3,
  maxCharsPerBlock: 1000,
  timeoutMs: 5000,
  maxOutputTokens: 256,
  verbose: false,
}

interface Captured {
  ctx: Context
  section: ReturnType<typeof vi.fn>
  listeners: Map<string, (first: unknown, next: () => unknown) => unknown>
  llmStream: ReturnType<typeof vi.fn>
}

function mount(overrides: Partial<Config> = {}): Captured {
  const section = vi.fn(() => () => {})
  const listeners = new Map<string, (first: unknown, next: () => unknown) => unknown>()
  const llmStream = vi.fn()
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    on: (event: string, handler: (first: unknown, next: () => unknown) => unknown) => {
      listeners.set(event, handler)
      return () => { listeners.delete(event) }
    },
    systemPrompt: { section },
    llm: { stream: llmStream },
  } as unknown as Context
  apply(ctx, { ...config, ...overrides })
  return { ctx, section, listeners, llmStream }
}

async function* upstreamOf(chunks: readonly StreamChunk[]): AsyncGenerator<StreamChunk> {
  yield* chunks
}

/** Fake `ctx.llm.stream` answering every request with one fixed text. */
function llmAnswering(text: string): (options: GenerateOptions) => AsyncGenerator<StreamChunk> {
  return async function* (options: GenerateOptions): AsyncGenerator<StreamChunk> {
    llmAnswering.captured.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
llmAnswering.captured = [] as GenerateOptions[]

describe('plugin configuration', () => {
  it.each([
    ['cjkThreshold', { cjkThreshold: -0.01 }],
    ['cjkThreshold', { cjkThreshold: 1.01 }],
    ['maxCharsPerBlock', { maxCharsPerBlock: 0 }],
    ['timeoutMs', { timeoutMs: -1 }],
    ['maxOutputTokens', { maxOutputTokens: 0 }],
    ['translateProvider', { translateProvider: '' }],
    ['translateModel', { translateModel: '' }],
  ])('rejects an invalid %s value during config loading', (_name, invalid) => {
    expect(() => PluginConfig({ ...config, ...invalid } as Config)).toThrow()
  })
})

describe('apply wiring', () => {
  it('registers nothing when steering is off and translate is disabled', () => {
    const { section, listeners } = mount({ steering: 'off' as SteeringMode, translate: false })
    expect(section).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it('registers only steering when translate is disabled', () => {
    const { section, listeners } = mount({ translate: false })
    expect(section).toHaveBeenCalledTimes(1)
    expect([...listeners.keys()]).toEqual(['agent/pre-step'])
  })

  it('registers the system section, the reminder, and the llm/stream listener by default', () => {
    const { section, listeners } = mount()
    expect(section).toHaveBeenCalledTimes(1)
    expect([...listeners.keys()].sort()).toEqual(['agent/pre-step', 'llm/stream'])
  })

  it('translates English reasoning end to end through the llm/stream listener', async () => {
    llmAnswering.captured = []
    const { listeners, llmStream } = mount()
    llmStream.mockImplementation(llmAnswering('用户让我检查目录。'))
    const listener = listeners.get('llm/stream')! as unknown as (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ) => AsyncIterable<StreamChunk>

    const out: StreamChunk[] = []
    for await (const chunk of listener({ signal: undefined } as GenerateOptions, () => upstreamOf([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'The user asks me to inspect the directory.' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'The user asks me to inspect the directory.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))) {
      out.push(chunk)
    }

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: '用户让我检查目录。' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '用户让我检查目录。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(llmAnswering.captured).toHaveLength(1)
    expect(llmAnswering.captured[0].provider).toBe('test-provider')
    expect(llmAnswering.captured[0].model).toBe('test-model')
  })

  it('skips translation for reasoning already above the CJK threshold', async () => {
    llmAnswering.captured = []
    const { listeners, llmStream } = mount()
    llmStream.mockImplementation(llmAnswering('不应被调用'))
    const listener = listeners.get('llm/stream')! as unknown as (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ) => AsyncIterable<StreamChunk>

    const out: StreamChunk[] = []
    for await (const chunk of listener({ signal: undefined } as GenerateOptions, () => upstreamOf([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: '用户让我先查看目录结构，再决定怎么改。' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '用户让我先查看目录结构，再决定怎么改。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))) {
      out.push(chunk)
    }

    expect(llmAnswering.captured).toHaveLength(0)
    expect(out[1]).toEqual({ type: 'reasoning-delta', index: 0, text: '用户让我先查看目录结构，再决定怎么改。' })
  })

  it('passes its own translation requests through untransformed', async () => {
    llmAnswering.captured = []
    const { listeners, llmStream } = mount()
    llmStream.mockImplementation(llmAnswering('第一次翻译'))
    const listener = listeners.get('llm/stream')! as unknown as (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ) => AsyncIterable<StreamChunk>

    // First call performs a translation and captures the aux request.
    for await (const _chunk of listener({ signal: undefined } as GenerateOptions, () => upstreamOf([
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'translate me' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))) { void _chunk }
    const ownRequest = llmAnswering.captured[0]
    expect(ownRequest).toBeDefined()

    // Second call with the aux request itself must short-circuit to next().
    const passthrough: StreamChunk[] = [
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'untouched' } },
    ]
    const out: StreamChunk[] = []
    for await (const chunk of listener(ownRequest, () => upstreamOf(passthrough))) {
      out.push(chunk)
    }
    expect(out).toEqual(passthrough)
  })

  it('enforces maxCharsPerBlock through the gate wiring', async () => {
    llmAnswering.captured = []
    const { listeners, llmStream } = mount({ maxCharsPerBlock: 5 })
    llmStream.mockImplementation(llmAnswering('不应被调用'))
    const listener = listeners.get('llm/stream')! as unknown as (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ) => AsyncIterable<StreamChunk>

    const long = 'a'.repeat(6)
    const out: StreamChunk[] = []
    for await (const chunk of listener({ signal: undefined } as GenerateOptions, () => upstreamOf([
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: long } },
    ]))) {
      out.push(chunk)
    }
    expect(llmAnswering.captured).toHaveLength(0)
    expect(out[0]).toEqual({ type: 'reasoning-delta', index: 0, text: long })
  })
})
