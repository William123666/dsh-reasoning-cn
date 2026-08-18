/**
 * dsh-reasoning-cn: steer DeepSeek Harness reasoning into Simplified Chinese.
 *
 * Layer 1 (steering) renders a language directive in the system prompt and as
 * a per-turn first-step reminder, so the model prefers Chinese thinking
 * natively. Layer 2 (translate) intercepts the `llm/stream` response seam:
 * reasoning blocks identified as non-Simplified by a CJK ratio or script
 * feature are translated through a cheap auxiliary model call. Successful
 * conversions reach both the Think disclosure and the session log.
 *
 * @module dsh-reasoning-cn
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { needsTranslation } from './detect.js'
import { DIRECTIVE_TEXT, installSection, installTurnReminder } from './steering.js'
import { makeLlmTranslator } from './translate-call.js'
import type { TranslateFn } from './translate-call.js'
import { transformReasoningStream } from './transform.js'

export const name = 'dsh-reasoning-cn'

export const inject = ['llm', 'systemPrompt']

/** Where the directive renders; `both` is the shipped default. */
export type SteeringMode = 'off' | 'system-section' | 'first-step-reminder' | 'both'

/** Plugin configuration, validated by the exported Schemastery schema. */
export interface Config {
  steering: SteeringMode
  /** Enable the `llm/stream` reasoning translator. */
  translate: boolean
  /** Provider route for translation calls. */
  translateProvider: string
  /** Model for translation calls; a cheap non-thinking route is expected. */
  translateModel: string
  /** Request `reasoningEffort: 'off'` on translation calls. */
  translateThinkingOff: boolean
  /** CJK ratio at or above which a reasoning block counts as Chinese and skips translation. */
  cjkThreshold: number
  /** Reasoning blocks longer than this skip translation and pass through verbatim. */
  maxCharsPerBlock: number
  /** Per-call timeout for translation requests. */
  timeoutMs: number
  /** `maxTokens` for translation requests. */
  maxOutputTokens: number
  /** Log each translation's size and duration. */
  verbose: boolean
}

export const Config: Schema<Config> = Schema.object({
  steering: Schema.union(['off', 'system-section', 'first-step-reminder', 'both'] as const).default('both'),
  translate: Schema.boolean().default(false),
  translateProvider: Schema.string().min(1).default('deepseek-official'),
  translateModel: Schema.string().min(1).default('deepseek-v4-flash'),
  translateThinkingOff: Schema.boolean().default(true),
  cjkThreshold: Schema.percent().default(0.3),
  maxCharsPerBlock: Schema.number().step(1).min(1).default(20000),
  timeoutMs: Schema.number().step(1).min(1).default(30000),
  maxOutputTokens: Schema.number().step(1).min(1).default(8192),
  verbose: Schema.boolean().default(false),
})

const log = (message: string): void => { console.log(`[${name}] ${message}`) }
const warn = (message: string): void => { console.warn(`[${name}] ${message}`) }

/**
 * Mount both layers on the plugin context.
 *
 * @param ctx - plugin context carrying `llm` and `systemPrompt`.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.steering === 'system-section' || config.steering === 'both') installSection(ctx)
  if (config.steering === 'first-step-reminder' || config.steering === 'both') installTurnReminder(ctx, name)

  if (!config.translate) return

  const ownRequests = new WeakSet<object>()
  const base = makeLlmTranslator(ctx.llm, {
    provider: config.translateProvider,
    model: config.translateModel,
    thinkingOff: config.translateThinkingOff,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
  }, ownRequests)
  const translate: TranslateFn = config.verbose
    ? async (text, signal) => {
      const startedAt = Date.now()
      const translated = await base(text, signal)
      log(`translated reasoning ${text.length} -> ${translated.length} chars in ${Date.now() - startedAt}ms`)
      return translated
    }
    : base

  ctx.on('llm/stream', (options, next) => {
    if (ownRequests.has(options)) return next()
    return transformReasoningStream(next(), {
      // The length check also covers adapters that emit reasoning only in
      // `block-end`, where no delta arrives early enough to hit the buffer cap.
      needsTranslation: text => text.length <= config.maxCharsPerBlock && needsTranslation(text, config.cjkThreshold),
      maxBufferedChars: config.maxCharsPerBlock,
      translate,
      signal: options.signal,
      onFallback: (text, error) => warn(
        `reasoning translation failed (${text.length} chars), keeping original: ${error instanceof Error ? error.message : String(error)}`,
      ),
    })
  }, { global: true })
}

export { DIRECTIVE_TEXT }
