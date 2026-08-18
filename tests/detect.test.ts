import { describe, expect, it } from 'vitest'
import { cjkRatio, hasTranslatableText, needsSimplifiedConversion, needsTranslation } from '../src/detect.js'

describe('cjkRatio', () => {
  it('reports 1 for pure Chinese text', () => {
    expect(cjkRatio('先查看目录结构，再决定修改方案。')).toBe(1)
  })

  it('reports 0 for pure English text', () => {
    expect(cjkRatio('The user asks me to inspect the directory first.')).toBe(0)
  })

  it('counts Chinese punctuation and fullwidth forms as CJK', () => {
    expect(cjkRatio('，。：；！？（）')).toBe(1)
  })

  it('ignores digits, whitespace, and code punctuation', () => {
    expect(cjkRatio('const x = 42; // 123')).toBe(0)
  })

  it('computes the share for mixed technical Chinese', () => {
    // 4 CJK chars (检查文件), 10 latin letters (srcindex.ts) -> 4/14.
    expect(cjkRatio('检查 src/index.ts 文件')).toBeCloseTo(4 / 14)
  })

  it('handles astral-plane CJK extension characters', () => {
    expect(cjkRatio('𠀀')).toBe(1)
  })

  it('reports 0 for empty text', () => {
    expect(cjkRatio('')).toBe(0)
  })
})

describe('needsTranslation', () => {
  it('skips empty text', () => {
    expect(needsTranslation('', 0.3)).toBe(false)
  })

  it('skips text at or above the threshold', () => {
    expect(needsTranslation('先查看目录结构。', 0.3)).toBe(false)
  })

  it('translates text below the threshold', () => {
    expect(needsTranslation('Inspect the directory structure first.', 0.3)).toBe(true)
  })

  it('skips code-only text under a positive threshold', () => {
    expect(hasTranslatableText('npm run build')).toBe(false)
    expect(needsTranslation('npm run build', 0.3)).toBe(false)
    expect(needsTranslation('src/index.ts:42', 0.3)).toBe(false)
  })

  it('translates Japanese even when its Han character ratio is high', () => {
    expect(needsSimplifiedConversion('ユーザーの要求を確認する')).toBe(true)
    expect(needsTranslation('ユーザーの要求を確認する', 0.3)).toBe(true)
  })

  it('translates recognizably Traditional Chinese into Simplified Chinese', () => {
    const traditional = '使用者請求先檢查目錄'
    expect(needsSimplifiedConversion(traditional)).toBe(true)
    expect(needsTranslation(traditional, 0.3)).toBe(true)
  })

  it('does not flag ordinary Simplified Chinese for script conversion', () => {
    expect(needsSimplifiedConversion('用户让我先查看目录结构')).toBe(false)
  })

  it('recognizes prose mixed with an inline code path', () => {
    expect(hasTranslatableText('Inspect src/index.ts before editing.')).toBe(true)
  })
})
