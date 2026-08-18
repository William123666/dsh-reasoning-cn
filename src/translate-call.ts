/**
 * Auxiliary LLM call that translates one buffered reasoning block.
 *
 * Follows the `dsh-session-title-llm` hand-built-call pattern: a frozen
 * one-shot `GenerateOptions` with its own provider/model route, dispatched
 * through `ctx.llm.stream` and assembled with `BlockAssembler`.
 *
 * @module dsh-reasoning-cn/translate-call
 */

import {
  BlockAssembler,
  ReasoningEffortId,
  createUserMessage,
  deepFreeze,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { hasTranslatableText, needsSimplifiedConversion } from './detect.js'

/** Route and bounds for translation calls. */
export interface TranslatorConfig {
  readonly provider: string
  readonly model: string
  /** Request `reasoningEffort: 'off'` so the cheap route does not think. */
  readonly thinkingOff: boolean
  readonly timeoutMs: number
  readonly maxOutputTokens: number
}

/** Translate one reasoning text, honoring the parent call's abort signal. */
export type TranslateFn = (text: string, signal: AbortSignal | undefined) => Promise<string>

const SYSTEM_PROMPT_TEXT = [
  '你是思考过程翻译器。将用户消息中 AI 助手的思考过程（reasoning）原文完整翻译或转换为简体中文。',
  '保持原文的结构与换行；代码、命令、文件路径、变量名、API 名称等保留原文，不要翻译、解释或总结。',
  '只输出译文本身，不要添加任何前后缀。',
].join('\n')

function withoutCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
}

function countFences(text: string): number {
  return text.match(/```/g)?.length ?? 0
}

export function validateTranslation(original: string, translated: string): void {
  const maximumLength = Math.max(256, original.length * 4)
  if (translated.length > maximumLength) throw new Error('translation output exceeded the length bound')
  if (countFences(original) !== countFences(translated)) throw new Error('translation changed code-fence structure')
  if (original.includes('\n') && !translated.includes('\n')) throw new Error('translation removed line structure')
  const visibleOriginal = withoutCode(original)
  const visibleTranslated = withoutCode(translated)
  if (hasTranslatableText(visibleOriginal)) {
    if (!/[\u3400-\u9fff\uf900-\ufaff]/u.test(visibleTranslated)) {
      throw new Error('translation did not contain Simplified-Chinese text')
    }
    if (needsSimplifiedConversion(visibleTranslated)) throw new Error('translation retained non-Simplified script')
  }
  if (translated.includes('\u0000')) throw new Error('translation contained a NUL character')
}

/**
 * Await one stream item while allowing a deadline to interrupt an adapter that
 * fails to observe its request signal. The iterator is closed best-effort by
 * the caller after cancellation; its eventual settlement is already observed
 * here, so it cannot become an unhandled rejection.
 */
function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => { signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then(
      result => {
        cleanup()
        resolve(result)
      },
      error => {
        cleanup()
        reject(error)
      },
    )
  })
}

/**
 * Build the translation function over one LLM runtime.
 *
 * @param llm - the runtime (or test fake) that dispatches `llm/stream`.
 * @param config - route and bounds for every translation call.
 * @param ownRequests - set the caller checks to skip transforming its own calls.
 * @returns the async translation function.
 */
export function makeLlmTranslator(
  llm: Pick<LlmRuntime, 'stream'>,
  config: TranslatorConfig,
  ownRequests: WeakSet<object>,
): TranslateFn {
  return async (text, parentSignal) => {
    const deadline = AbortSignal.timeout(config.timeoutMs)
    const signal = parentSignal === undefined ? deadline : AbortSignal.any([parentSignal, deadline])
    const options: GenerateOptions = deepFreeze({
      provider: config.provider,
      model: config.model,
      ...config.thinkingOff ? { reasoningEffort: ReasoningEffortId('off') } : {},
      messages: [createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-reasoning-cn/translate' },
      })],
      system: SYSTEM_PROMPT_TEXT,
      maxTokens: config.maxOutputTokens,
      signal,
    })
    ownRequests.add(options)
    const assembler = new BlockAssembler()
    const iterator = llm.stream(options)[Symbol.asyncIterator]()
    let sawTerminalFinish = false
    try {
      while (true) {
        const item = await nextOrAbort(iterator, signal)
        if (item.done) break
        signal.throwIfAborted()
        if (item.value.type === 'finish') sawTerminalFinish = true
        assembler.push(item.value)
      }
    } finally {
      // A compliant adapter observes `signal`; this is an extra best-effort
      // cleanup for adapters that only respond to iterator cancellation. Never
      // await it: a non-compliant iterator must not defeat the timeout.
      if (signal.aborted) void Promise.resolve(iterator.return?.()).catch(() => undefined)
    }
    signal.throwIfAborted()
    if (!sawTerminalFinish) throw new Error('translation stream ended without terminal finish')
    const finish = assembler.finish
    if (finish.kind !== 'stop') {
      const detail = finish.kind === 'error' || finish.kind === 'aborted'
        ? `: ${finish.failure.message}`
        : ''
      throw new Error(`translation stream ended with ${finish.kind}${detail}`)
    }
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type === 'tool-call')) {
      throw new Error('translation model produced tool calls')
    }
    const translated = blocks
      .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (translated.trim() === '') throw new Error('translation model produced no text')
    validateTranslation(text, translated)
    return translated
  }
}

/** Exposed for tests: the chunk types a translation stream may legally emit. */
export type TranslateStreamChunk = StreamChunk
