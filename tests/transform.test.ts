import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { transformReasoningStream } from '../src/transform.js'
import type { TransformOptions } from '../src/transform.js'

async function* upstreamOf(chunks: readonly StreamChunk[]): AsyncGenerator<StreamChunk> {
  yield* chunks
}

function makeOptions(overrides: Partial<TransformOptions> = {}): TransformOptions {
  return {
    needsTranslation: () => true,
    translate: async text => `【译】${text}`,
    signal: undefined,
    onFallback: vi.fn(),
    ...overrides,
  }
}

async function collect(chunks: readonly StreamChunk[], options: TransformOptions): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const transformed of transformReasoningStream(upstreamOf(chunks), options)) {
    out.push(transformed)
  }
  return out
}

function reasoningDelta(index: number, text: string): StreamChunk {
  return { type: 'reasoning-delta', index, text }
}

describe('transformReasoningStream', () => {
  it('passes a text-only stream through verbatim', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    expect(await collect(chunks, makeOptions())).toEqual(chunks)
  })

  it('replaces a reasoning block with one translated delta and a rewritten block-end', async () => {
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'The user '),
      reasoningDelta(0, 'asks.'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'The user asks.' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'Answer.' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'Answer.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions())

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, '【译】The user asks.'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '【译】The user asks.' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'Answer.' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'Answer.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('collapses gated-out Chinese reasoning into one original delta and the original block-end', async () => {
    const onFallback = vi.fn()
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, '先查看'),
      reasoningDelta(0, '目录。'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先查看目录。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions({ needsTranslation: () => false, onFallback }))

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, '先查看目录。'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先查看目录。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('falls back to the original text when translation fails without abort', async () => {
    const onFallback = vi.fn()
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'English reasoning.'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'English reasoning.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions({
      translate: async () => { throw new Error('boom') },
      onFallback,
    }))

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'English reasoning.'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'English reasoning.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback.mock.calls[0][0]).toBe('English reasoning.')
  })

  it('preserves the complete original when a truncated translation is rejected', async () => {
    const original = 'The complete reasoning must not be replaced by a prefix.'
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, original),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: original } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions({
      translate: async () => { throw new Error('translation stream ended with max-tokens') },
    }))

    expect(out[1]).toEqual(reasoningDelta(0, original))
    expect(out[2]).toEqual({ type: 'block-end', index: 0, block: { type: 'reasoning', text: original } })
  })

  it('propagates the error when the parent signal aborted during translation', async () => {
    const controller = new AbortController()
    const options = makeOptions({
      signal: controller.signal,
      translate: async () => {
        controller.abort()
        throw new Error('aborted!')
      },
    })
    const stream = transformReasoningStream(upstreamOf([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'text'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'text' } },
    ]), options)
    const iterator = stream[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'block-start', index: 0, blockType: 'reasoning' } })
    await expect(iterator.next()).rejects.toThrow('aborted!')
  })

  it('keeps block order across interleaved reasoning and text blocks', async () => {
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'first think'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'first think' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'mid answer' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'mid answer' } },
      { type: 'block-start', index: 2, blockType: 'reasoning' },
      reasoningDelta(2, 'second think'),
      { type: 'block-end', index: 2, block: { type: 'reasoning', text: 'second think' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions())

    expect(out.map(chunk => chunk.type)).toEqual([
      'block-start', 'reasoning-delta', 'block-end',
      'block-start', 'text-delta', 'block-end',
      'block-start', 'reasoning-delta', 'block-end',
      'finish',
    ])
    expect(out[1]).toEqual(reasoningDelta(0, '【译】first think'))
    expect(out[7]).toEqual(reasoningDelta(2, '【译】second think'))
  })

  it('flushes an unterminated reasoning block before usage and finish, exactly once', async () => {
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'never closed'),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions())

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, '【译】never closed'),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('flushes a pending block when the stream ends without a finish chunk', async () => {
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'dangling'),
    ], makeOptions())

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, '【译】dangling'),
    ])
  })

  it('translates a block-end-only reasoning block from its end text', async () => {
    const out = await collect([
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'whole block at once' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions())

    expect(out).toEqual([
      reasoningDelta(0, '【译】whole block at once'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '【译】whole block at once' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('drops straggler reasoning deltas after the block-end', async () => {
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'text'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'text' } },
      reasoningDelta(0, 'straggler'),
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions())

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, '【译】text'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '【译】text' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('passes an empty reasoning block-end through without a delta', async () => {
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions())

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('stops buffering and passes original deltas through once the cap is exceeded', async () => {
    const translate = vi.fn(async (text: string) => `【译】${text}`)
    const out = await collect([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'ab'),
      reasoningDelta(0, 'cd'),
      reasoningDelta(0, 'ef'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'abcdef' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], makeOptions({ maxBufferedChars: 3, translate }))

    expect(out).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      reasoningDelta(0, 'abcd'),
      reasoningDelta(0, 'ef'),
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'abcdef' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(translate).not.toHaveBeenCalled()
  })
})
