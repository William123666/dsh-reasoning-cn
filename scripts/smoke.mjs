/**
 * End-to-end smoke: mount the built plugin on a real Cordis context with the
 * real `dsh-system-prompt` and `dsh-llm` services, drive one model call
 * through a fake adapter, and assert the reasoning comes back translated.
 *
 * Run after `npm run build`: `node scripts/smoke.mjs`
 */

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Plugin from '../lib/index.js'

const ENGLISH_REASONING = 'The user asks me to inspect the directory.'
const CHINESE_TRANSLATION = '用户让我检查目录。'

class FakeAdapter extends LlmAdapter {
  async *stream(options) {
    if (options.system?.includes('思考过程翻译器')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: CHINESE_TRANSLATION }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: CHINESE_TRANSLATION } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: ENGLISH_REASONING }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: ENGLISH_REASONING } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`smoke failed: ${message}`)
}

const ctx = new Context()
try {
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(LlmRuntime, {})
  ctx.llm.registerAdapter(['smoke-test'], new FakeAdapter())

  await ctx.plugin(Plugin, {
    translate: true,
    translateProvider: 'smoke-test',
    translateModel: 'fake-model',
    // The fake model advertises no reasoning metadata, so it must not receive
    // an effort request; this also exercises the config surface end to end.
    translateThinkingOff: false,
  })

  const assembly = await ctx.systemPrompt.assemble()
  const prompt = renderPrompt(assembly)
  assert(prompt.includes('始终使用简体中文进行思考'), 'directive section missing from assembled system prompt')

  const chunks = []
  for await (const chunk of ctx.llm.stream({
    provider: 'smoke-test',
    model: 'fake-model',
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'inspect the directory' }],
      source: { kind: 'user' },
    })],
  })) {
    chunks.push(chunk)
  }

  const reasoning = chunks.filter(chunk => chunk.type === 'reasoning-delta')
  assert(reasoning.length === 1 && reasoning[0].text === CHINESE_TRANSLATION,
    `expected one translated reasoning delta, got ${JSON.stringify(reasoning)}`)
  const end = chunks.find(chunk => chunk.type === 'block-end')
  assert(end?.block?.text === CHINESE_TRANSLATION, 'block-end not rewritten with the translation')

  console.log('[smoke] PASS: directive in system prompt; reasoning translated on the llm/stream seam')
  process.exitCode = 0
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  process.exit(process.exitCode)
}
