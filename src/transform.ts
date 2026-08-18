/**
 * Response-side reasoning translator for the `llm/stream` waterfall.
 *
 * Wraps the upstream chunk stream: reasoning deltas are buffered per block
 * index, the assembled text is translated when the CJK gate says so, and the
 * consumer receives exactly one reasoning delta plus (when the adapter closed
 * the block) a rewritten `block-end`. Every other chunk passes through
 * verbatim in stream order. Failure of the translation call falls back to the
 * original text; abort of the parent request propagates.
 *
 * Ordering: `block-start` chunks pass through immediately, so the
 * `BlockAssembler` and the web client keep the adapter's block order. Deltas
 * are deferred only while a block stays within its translation buffer limit;
 * an oversized block switches to original-delta passthrough immediately.
 *
 * @module dsh-reasoning-cn/transform
 */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'

/** A `block-end` chunk whose block is a reasoning block. */
type ReasoningEnd = Extract<StreamChunk, { type: 'block-end' }> & { block: { type: 'reasoning'; text: string } }

/** Pending reasoning block, optionally switched to original-delta passthrough. */
interface BufferedReasoning {
  text: string
  passthrough: boolean
}

/** Dependencies injected by the plugin entry. */
export interface TransformOptions {
  /** Whether one assembled reasoning text should be translated. */
  readonly needsTranslation: (text: string) => boolean
  /** Maximum original characters held before the block switches to passthrough. */
  readonly maxBufferedChars?: number
  /** Translate the text; must reject promptly when `signal` aborts. */
  readonly translate: (text: string, signal: AbortSignal | undefined) => Promise<string>
  /** Abort signal of the parent model call, when the request carried one. */
  readonly signal: AbortSignal | undefined
  /** Diagnostic sink for fail-open fallbacks (translation error, non-abort). */
  readonly onFallback: (text: string, error: unknown) => void
}

/**
 * Build the transformed stream. Consuming it drives the upstream; abandoning
 * it (break/return/throw) propagates cancellation through the generator's
 * implicit return.
 *
 * @param upstream - the adapter stream obtained from the waterfall's `next()`.
 * @param options - gate, translator, parent signal, and diagnostics.
 * @returns the transformed chunk stream.
 */
export function transformReasoningStream(
  upstream: AsyncIterable<StreamChunk>,
  options: TransformOptions,
): AsyncIterable<StreamChunk> {
  async function* run(): AsyncGenerator<StreamChunk> {
    /** Buffered original reasoning text per block index. */
    const buffered = new Map<number, BufferedReasoning>()
    const maxBufferedChars = options.maxBufferedChars ?? Number.POSITIVE_INFINITY
    /** Indexes already closed by a reasoning `block-end`; stragglers drop. */
    const closed = new Set<number>()

    /** Emit one buffered index: translated when eligible, verbatim otherwise. */
    async function* flush(index: number, endBlock: ReasoningEnd | undefined): AsyncGenerator<StreamChunk> {
      const state = buffered.get(index)
      const original = state?.text ?? endBlock?.block.text ?? ''
      buffered.delete(index)
      // Deltas already left the stream once the bounded buffer overflowed; do
      // not re-emit them or attempt a partial translation.
      if (state?.passthrough) {
        if (endBlock !== undefined) yield endBlock
        return
      }
      if (original === '') {
        if (endBlock !== undefined) yield endBlock
        return
      }
      if (options.needsTranslation(original)) {
        try {
          const translated = await options.translate(original, options.signal)
          yield { type: 'reasoning-delta', index, text: translated }
          if (endBlock !== undefined) {
            yield { type: 'block-end', index, block: { type: 'reasoning', text: translated } }
          }
          return
        } catch (error) {
          if (options.signal?.aborted) throw error
          options.onFallback(original, error)
        }
      }
      yield { type: 'reasoning-delta', index, text: original }
      if (endBlock !== undefined) yield endBlock
    }

    for await (const chunk of upstream) {
      if (chunk.type === 'reasoning-delta') {
        if (closed.has(chunk.index)) continue
        const state = buffered.get(chunk.index) ?? { text: '', passthrough: false }
        if (state.passthrough) {
          yield chunk
          continue
        }
        state.text += chunk.text
        if (state.text.length > maxBufferedChars) {
          // Forward the buffered prefix as one delta, then pass each following
          // delta through. This caps retained text without changing its bytes.
          yield { type: 'reasoning-delta', index: chunk.index, text: state.text }
          state.text = ''
          state.passthrough = true
        }
        buffered.set(chunk.index, state)
        continue
      }
      if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') {
        const endBlock: ReasoningEnd = { type: 'block-end', index: chunk.index, block: chunk.block }
        closed.add(chunk.index)
        yield* flush(chunk.index, endBlock)
        continue
      }
      if (chunk.type === 'usage' || chunk.type === 'finish') {
        for (const index of [...buffered.keys()]) yield* flush(index, undefined)
      }
      yield chunk
    }
    for (const index of [...buffered.keys()]) yield* flush(index, undefined)
  }
  return run()
}
