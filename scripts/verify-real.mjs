/**
 * Real-model A/B verification against one live provider route.
 *
 * Boots two fresh Cordis contexts with the real `dsh-system-prompt`,
 * `dsh-llm`, and `dsh-llm-pi-ai` services; sends the same English technical
 * prompt twice - once without the plugin (control), once with the translator
 * enabled but steering off - and verifies that a real auxiliary translation
 * request produced Simplified-Chinese reasoning.
 *
 * This is an opt-in maintainer integration check. It sends the prompt and
 * reasoning to the configured provider, may incur cost, and must never run in
 * CI. Run `npm run build` first, then explicitly provide every VERIFY_* value
 * documented in README.md; the script has no provider, endpoint, or credential
 * defaults.
 */

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import { cjkRatio } from '../lib/detect.js'
import * as Plugin from '../lib/index.js'

function requiredEnv(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`set ${name} before running npm run verify:real`)
  return value
}

const provider = requiredEnv('VERIFY_PROVIDER')
const apiKeyEnv = requiredEnv('VERIFY_API_KEY_ENV')
const baseURL = requiredEnv('VERIFY_BASE_URL')
const api = requiredEnv('VERIFY_API')
const model = requiredEnv('VERIFY_MODEL')

const prompt = [
  'Why does this Python snippet print [10, 10] instead of [10, 20]? Diagnose the root cause and show the corrected code.',
  '',
  'fns = []',
  'for i in range(2):',
  '    fns.append(lambda: i * 10)',
  'print([f() for f in fns])',
].join('\n')

function assertProviderCredential() {
  if (process.env[apiKeyEnv] === undefined || process.env[apiKeyEnv] === '') {
    throw new Error(`set the provider credential ${apiKeyEnv} before running npm run verify:real`)
  }
}

async function boot(withPlugin) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(LlmRuntime, {})
  await ctx.plugin(piAi, {
    providers: {
      [provider]: {
        apiKeyEnv,
        api,
        baseURL,
        models: [{
          id: model,
          name: model,
        }],
      },
    },
  })
  let translationRequests = 0
  if (withPlugin) {
    await ctx.plugin(Plugin, {
      steering: 'off',
      translate: true,
      translateProvider: provider,
      translateModel: model,
      // The route declares no reasoning efforts, so the translation call must
      // not request one; the route's default thinking applies.
      translateThinkingOff: false,
      verbose: true,
    })
    ctx.on('llm/stream', (options, next) => {
      if (options.messages.some(message => message.source?.kind === 'plugin' && message.source.plugin === 'dsh-reasoning-cn/translate')) {
        translationRequests++
      }
      return next()
    }, { global: true })
  }
  return { ctx, translationRequests: () => translationRequests }
}

async function drive(ctx) {
  const reasoning = []
  const text = []
  let finish
  for await (const chunk of ctx.llm.stream({
    provider,
    model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    })],
  })) {
    if (chunk.type === 'reasoning-delta') reasoning.push(chunk.text)
    else if (chunk.type === 'text-delta') text.push(chunk.text)
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
    throw new Error(`model stream failed (${finish.kind}): ${finish.failure.message}`)
  }
  return { reasoning: reasoning.join(''), text: text.join('') }
}

function report(label, { reasoning, text }) {
  const reasoningSample = reasoning.slice(0, 80).replace(/\n/g, ' ')
  console.log(`[${label}] reasoning: ${reasoning.length} chars, CJK ratio ${cjkRatio(reasoning).toFixed(2)}`)
  if (reasoningSample !== '') console.log(`[${label}] reasoning head: ${reasoningSample}`)
  console.log(`[${label}] answer: ${text.length} chars, CJK ratio ${cjkRatio(text).toFixed(2)}`)
}

assertProviderCredential()
console.log(`verify route: ${provider}/${model} via ${baseURL}`)

const control = await boot(false)
try {
  report('control  ', await drive(control.ctx))
} finally {
  process.exitCode = process.exitCode ?? 0
}

const plugin = await boot(true)
try {
  const result = await drive(plugin.ctx)
  report('plugin   ', result)
  const translations = plugin.translationRequests()
  if (translations === 0) {
    throw new Error('the model did not emit translatable reasoning; choose a route that emits English reasoning and rerun')
  }
  if (result.reasoning === '' || cjkRatio(result.reasoning) < 0.3) {
    throw new Error('the translated reasoning did not meet the Simplified-Chinese gate')
  }
  console.log(`[plugin   ] PASS: ${translations} auxiliary translation request(s); translated reasoning passed the CJK gate`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  process.exit(process.exitCode)
}
