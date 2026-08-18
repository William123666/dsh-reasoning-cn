/**
 * Steering layer: render the Simplified-Chinese reasoning directive as a
 * system-prompt section and as a per-turn first-step `<system-reminder>` user
 * message so the rule survives context compaction.
 *
 * @module dsh-reasoning-cn/steering
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** The directive text both steering surfaces render. */
export const DIRECTIVE_TEXT: string = [
  '始终使用简体中文进行思考（reasoning）与所有最终回答。',
  '计划、工具调用说明、总结、代码注释同样使用简体中文。',
  '仅代码、命令、文件路径、变量名、API 名称等必须原样保留的内容使用英文。',
  '除非用户明确要求其他语言，否则本规则优先。',
].join('\n')

/** System-prompt section name registered against `ctx.systemPrompt`. */
export const SECTION_NAME = 'reasoning-cn:directive'

/** Snapshot-section name carried by the per-turn reminder message source. */
export const REMINDER_SECTION_NAME = 'reasoning-cn-directive'

/**
 * Register the directive as an order-10 system-prompt section: after the
 * deployment persona (order 0), before tool guidance (100-199). Static text,
 * so the rendered system prompt stays prefix-stable across turns.
 *
 * @param ctx - plugin context; requires the `systemPrompt` service.
 */
export function installSection(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: 10,
    text: DIRECTIVE_TEXT,
  }))
}

/**
 * Register an `agent/pre-step` listener appending one `<system-reminder>` user
 * message carrying the directive at the first step of every turn. The loop
 * logs injected messages as ordinary `user/message` events, keeping requests
 * reconstructable from the session log.
 *
 * @param ctx - plugin context.
 * @param pluginName - the plugin's loader identity for message attribution.
 */
export function installTurnReminder(ctx: Context, pluginName: string): void {
  ctx.on('agent/pre-step', async ({ step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1 || signal.aborted) return decision
    return {
      kind: 'enter',
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: `<system-reminder>\n${DIRECTIVE_TEXT}\n</system-reminder>` }],
        source: {
          kind: 'plugin',
          plugin: pluginName,
          form: 'snapshot',
          sections: [{ name: REMINDER_SECTION_NAME, text: DIRECTIVE_TEXT }],
        },
      })],
    }
  }, { prepend: true })
}
