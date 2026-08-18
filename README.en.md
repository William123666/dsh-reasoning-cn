# dsh-reasoning-cn

[中文](./README.md)

DeepSeek Harness plugin that steers reasoning toward Simplified Chinese and can translate eligible reasoning blocks at the `llm/stream` seam.

> [!NOTE]
> This is an unofficial community plugin. It is not affiliated with, maintained by, or endorsed by DeepSeek or the DeepSeek Harness maintainers.

> [!WARNING]
> When enabled, the translation layer sends the complete reasoning block to the configured provider/model and replaces the reasoning stored in session logs, Web replay, and subsequent model context. Reasoning may contain user data, tool output, source code, paths, or accidental credentials. Translation is disabled by default; enable it only after checking the provider's retention policy, access scope, and cost.

## Install

```sh
dsh plugin --profile web add dsh-reasoning-cn
```

The bundled Cordis patch mounts `dsh-reasoning-cn`. Set `translate: true` explicitly to enable translation. The steering layer remains available with `translate: false` and makes no auxiliary LLM calls.

## Compatibility

- Verified with `@deepseek-ai/cordis` `4.0.1`, the DSH `0.1.0-rc.7` package set, Node.js `22.19.0`, and current 24.x.
- DeepSeek Harness is in Developer Preview and may make breaking API changes. Run `npm run verify` in a test environment before upgrading DSH, and include all versions in a compatibility report.
- Peer dependencies intentionally remain pinned to the verified rc.7 release until a newer version has passed the suite.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:check
npm run verify
```

Requires Node.js 22.19 or newer. The development overlay in `mount/dev.cordis.yml` uses a placeholder absolute path; replace it before mounting a local build.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `steering` | `both` | `off`, `system-section`, `first-step-reminder`, or `both` |
| `translate` | `false` | Master switch for auxiliary reasoning translation |
| `translateProvider` | `deepseek-official` | Provider route for translation calls |
| `translateModel` | `deepseek-v4-flash` | Translation model route |
| `translateThinkingOff` | `true` | Requests `reasoningEffort: 'off'` for translation |
| `cjkThreshold` | `0.3` | CJK ratio at or above which text counts as Chinese |
| `maxCharsPerBlock` | `20000` | Maximum buffered reasoning characters before verbatim fallback |
| `timeoutMs` | `30000` | Per-translation timeout in milliseconds |
| `maxOutputTokens` | `8192` | Maximum translation output tokens |
| `verbose` | `false` | Logs translation size and duration |

For a DSH profile patch, configure the mounted plugin with a block such as:

```yaml
- insert:
    - id: reasoning-cn
      name: dsh-reasoning-cn
      config:
        steering: both
        translate: true
        translateProvider: your-provider
        translateModel: your-translation-model
        translateThinkingOff: true
```

The translation layer sends complete eligible reasoning to the configured provider. Successful output replaces reasoning in session logs, Web replay, and subsequent model context; failed validation, timeout, or provider errors keep the original text. It is not a redaction layer and cannot fully prevent prompt injection. See the Chinese README for the complete behavior and limitations.

## Real-provider verification (maintainers only)

`npm run verify:real` sends the test prompt and model reasoning to a live provider and can incur cost. It never runs in CI. Build first, then provide all route and credential-environment details explicitly:

```sh
VERIFY_PROVIDER=your-provider \
VERIFY_API_KEY_ENV=YOUR_PROVIDER_API_KEY \
VERIFY_BASE_URL=https://your-provider.example/v1 \
VERIFY_API=openai-completions \
VERIFY_MODEL=your-model \
npm run verify:real
```

Keep the actual credential only in the shell environment. The check disables steering, requires an auxiliary translation request, and verifies that the resulting reasoning passes the Chinese-content gate.

Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to the GitHub repository for DeepSeek Harness community discovery.

## License

MIT, see [LICENSE](./LICENSE).
