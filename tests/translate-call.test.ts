import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { makeLlmTranslator } from '../src/translate-call.js'
import type { TranslatorConfig } from '../src/translate-call.js'

const config: TranslatorConfig = {
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  thinkingOff: true,
  timeoutMs: 5000,
  maxOutputTokens: 512,
}

function textStream(text: string, captured?: (options: GenerateOptions) => void) {
  return {
    stream: async function* (options: GenerateOptions): AsyncGenerator<never | { type: 'block-start'; index: number; blockType: 'text' } | { type: 'text-delta'; index: number; text: string } | { type: 'block-end'; index: number; block: { type: 'text'; text: string } } | { type: 'finish'; reason: { kind: 'stop' } }> {
      captured?.(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

describe('makeLlmTranslator', () => {
  it('builds a frozen one-shot request and returns the assembled text', async () => {
    let seen: GenerateOptions | undefined
    const own = new WeakSet<object>()
    const translate = makeLlmTranslator(textStream('你好，世界。', options => { seen = options }), config, own)

    const result = await translate('Hello, world.', undefined)

    expect(result).toBe('你好，世界。')
    expect(seen).toBeDefined()
    expect(Object.isFrozen(seen)).toBe(true)
    expect(own.has(seen!)).toBe(true)
    expect(seen!.provider).toBe('deepseek-official')
    expect(seen!.model).toBe('deepseek-v4-flash')
    expect(seen!.reasoningEffort).toBe('off')
    expect(seen!.maxTokens).toBe(512)
    expect(seen!.system).toContain('思考过程翻译器')
    expect(seen!.messages).toHaveLength(1)
    expect(seen!.messages[0].content).toEqual([{ type: 'text', text: 'Hello, world.' }])
    expect(seen!.messages[0].source).toMatchObject({ kind: 'plugin', plugin: 'dsh-reasoning-cn/translate' })
  })

  it('omits reasoningEffort when thinkingOff is false', async () => {
    let seen: GenerateOptions | undefined
    const translate = makeLlmTranslator(
      textStream('你好', options => { seen = options }),
      { ...config, thinkingOff: false },
      new WeakSet<object>(),
    )
    await translate('hi', undefined)
    expect(seen!.reasoningEffort).toBeUndefined()
  })

  it('rejects on an error finish', async () => {
    const failing = {
      stream: async function* (): AsyncGenerator<{ type: 'finish'; reason: { kind: 'error'; failure: { message: string; code: string } } }> {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: 'RATE_LIMIT' } } }
      },
    }
    const translate = makeLlmTranslator(failing as never, config, new WeakSet<object>())
    await expect(translate('text', undefined)).rejects.toThrow(/error: rate limited/)
  })

  it('rejects a max-token-truncated translation so the caller can preserve the original', async () => {
    const truncated = {
      stream: async function* (): AsyncGenerator<
        | { type: 'block-start'; index: number; blockType: 'text' }
        | { type: 'text-delta'; index: number; text: string }
        | { type: 'finish'; reason: { kind: 'max-tokens' } }
      > {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '只翻译了前半段' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      },
    }
    const translate = makeLlmTranslator(truncated as never, config, new WeakSet<object>())
    await expect(translate('complete English reasoning', undefined)).rejects.toThrow('max-tokens')
  })

  it('preserves leading and trailing whitespace in a non-empty translation', async () => {
    const translate = makeLlmTranslator(textStream('\n  译文  \n'), config, new WeakSet<object>())
    await expect(translate('text', undefined)).resolves.toBe('\n  译文  \n')
  })

  it('rejects when the model produces no text', async () => {
    const empty = {
      stream: async function* (): AsyncGenerator<{ type: 'finish'; reason: { kind: 'stop' } }> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const translate = makeLlmTranslator(empty as never, config, new WeakSet<object>())
    await expect(translate('text', undefined)).rejects.toThrow('translation model produced no text')
  })

  it('rejects a stream that ends without a terminal finish', async () => {
    const unterminated = {
      stream: async function* (): AsyncGenerator<{ type: 'text-delta'; index: number; text: string }> {
        yield { type: 'text-delta', index: 0, text: '半截译文' }
      },
    }
    const translate = makeLlmTranslator(unterminated as never, config, new WeakSet<object>())
    await expect(translate('text', undefined)).rejects.toThrow('without terminal finish')
  })

  it('rejects when the model answers with tool calls', async () => {
    const tooly = {
      stream: async function* (): AsyncGenerator<never | { type: 'block-end'; index: number; block: { type: 'tool-call'; id: string; name: string; arguments: string } } | { type: 'finish'; reason: { kind: 'stop' } }> {
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-0', name: 'x', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const translate = makeLlmTranslator(tooly as never, config, new WeakSet<object>())
    await expect(translate('text', undefined)).rejects.toThrow('translation model produced tool calls')
  })

  it('rejects output that loses code fences', async () => {
    const translate = makeLlmTranslator(textStream('请运行代码'), config, new WeakSet<object>())
    await expect(translate('Run this:\n```sh\nnpm test\n```', undefined)).rejects.toThrow('code-fence')
  })

  it('rejects non-Chinese expansion from a translation response', async () => {
    const translate = makeLlmTranslator(textStream('This is still English.'), config, new WeakSet<object>())
    await expect(translate('Translate this sentence.', undefined)).rejects.toThrow('Simplified-Chinese')
  })

  it('rejects promptly when the parent signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const translate = makeLlmTranslator(textStream('你好'), config, new WeakSet<object>())
    await expect(translate('text', controller.signal)).rejects.toThrow()
  })

  it('does not mark requests when a different WeakSet is used', async () => {
    const ownA = new WeakSet<object>()
    const ownB = new WeakSet<object>()
    let seen: GenerateOptions | undefined
    const translate = makeLlmTranslator(textStream('你好', options => { seen = options }), config, ownA)
    await translate('text', undefined)
    expect(ownA.has(seen!)).toBe(true)
    expect(ownB.has(seen!)).toBe(false)
  })
})

describe('makeLlmTranslator timeout', () => {
  it('enforces the configured deadline when the stream stalls but honors the signal', async () => {
    const slow = {
      // Mirrors the adapter contract: a stalled stream still ends when its
      // request signal aborts, here the deadline the translator attaches.
      stream: async function* (options: GenerateOptions): AsyncGenerator<never | { type: 'block-start'; index: number; blockType: 'text' } | { type: 'text-delta'; index: number; text: string } | { type: 'finish'; reason: { kind: 'stop' } }> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '慢' }
        const signal = options.signal
        if (signal === undefined) throw new Error('smoke fixture requires a signal')
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(signal.reason) })
        })
      },
    }
    const translate = makeLlmTranslator(slow as never, { ...config, timeoutMs: 100 }, new WeakSet<object>())
    await expect(translate('text', undefined)).rejects.toThrow()
  }, 10_000)

  it('rejects on deadline even when an adapter ignores its abort signal', async () => {
    const nonCooperative = {
      stream: async function* (): AsyncGenerator<never | { type: 'block-start'; index: number; blockType: 'text' }> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        await new Promise<void>(() => {})
      },
    }
    const translate = makeLlmTranslator(nonCooperative as never, { ...config, timeoutMs: 25 }, new WeakSet<object>())
    await expect(translate('text', undefined)).rejects.toThrow()
  }, 10_000)
})
