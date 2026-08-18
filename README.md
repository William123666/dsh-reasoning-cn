# dsh-reasoning-cn

[English](./README.en.md)

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的思考过程（Web UI 中 Think 下拉框里的 reasoning 内容）尽量使用简体中文的插件。

> [!NOTE]
> 这是一个非官方社区插件，与 DeepSeek 或 DeepSeek Harness 的维护方不存在隶属或背书关系。

> [!WARNING]
> 翻译层会把完整的 reasoning 发送到你配置的 provider/model，并将成功的译文写入 session 日志、Web 回放以及后续模型上下文。reasoning 可能包含用户数据、工具返回内容、源代码、文件路径或意外的凭证。默认不启用翻译；只有在确认 provider 的数据保留政策、访问范围和费用后，才应显式设置 `translate: true`。

采用两层设计：

1. **引导层（steering）**：在系统提示词中渲染一条 order-10 的语言指令段落，并在每个 turn 的第 1 步追加一条 `<system-reminder>` 用户消息重申该指令（压缩上下文后依然每 turn 生效）。模型配合时零成本、零延迟，原生用中文思考。
2. **翻译层（translate）**：挂接 `llm/stream` 瀑布的响应侧。模型思考是英文、日文或可识别的繁体中文（CJK 占比低于阈值，或命中日文/繁体特征）时，缓冲该 reasoning 块，调用廉价辅助模型（默认 `deepseek-official` 路由的 `deepseek-v4-flash`，非思考模式）整块翻译或转换为简体中文，再以翻译后的 delta 与重写过的 `block-end` 产出。共享汉字无法可靠区分简繁时会保守地保留原文。

模型本身（DeepSeek、Claude 等）目前都没有"指定思考语言"的 API 参数，系统提示词对 agent 模式下的 reasoning 语言经常无效（见 [DeepSeek-V3#1240](https://github.com/deepseek-ai/DeepSeek-V3/issues/1240)、[claude-code#27051](https://github.com/anthropics/claude-code/issues/27051)）。引导层提高中文概率，翻译层兜底显示语言，两层互补。

## 行为细节

- **失败降级（fail-open）**：翻译调用失败、超时（`timeoutMs`）、非 `stop` 结束（包括 token 截断）或超过 `maxCharsPerBlock` 时，保留原始 reasoning 透传，内容不丢失；仅 warn 一行日志。用户中止（abort）会正常传播取消整个流。
- **流式体验**：在 `maxCharsPerBlock` 以内，思考块结束并翻译完成后一次性显示；超过阈值时立即改为原文 delta 透传，不再累积整块内容。增量流式翻译是 v2 候选。
- **日志与回传一致性**：翻译发生在 agent-loop 落日志之前，因此成功转换后的 session 日志、Web 回放、以及 DeepSeek 工具调用回合回传的 `reasoning_content` 都是简体中文；翻译降级时三者一致地保留原文。
- **防递归**：插件自身的翻译请求经 WeakSet 标记，不会再被自己的转换器处理。
- **最终回答不受翻译层影响**：text 块原样透传，回答语言由引导层负责。
- **成本**：每个英文 reasoning 块一次 flash 非思考调用（输入≈思考长度，输出≈译文长度）。`verbose: true` 打印每次翻译的字符数与耗时。

## 安装与挂载

### 方式一：源码 checkout 开发挂载

```sh
cd ~/code/dsh-reasoning-cn
npm ci && npm run build

# 从 harness checkout 启动 Web，附上 overlay：
cd ~/code/deepseek-harness
pnpm dsh web --patch /absolute/path/to/dsh-reasoning-cn/mount/dev.cordis.yml
```

将 `mount/dev.cordis.yml` 中的 `ABSOLUTE_PATH_TO_DSH_REASONING_CN` 替换为本地绝对路径。开发依赖使用 npm 上已发布并验证过的 DSH rc.7 包；若要联调 harness 源码，请使用单独的 overlay，不要把本地 `file:` 依赖提交到默认安装链路。

### 方式二：发布后安装

```sh
dsh plugin --profile web add dsh-reasoning-cn
```

（包内 `cordis.patch.yml` 声明持久挂载行 `reasoning-cn`。）

翻译默认关闭。需要启用时，在插件配置中设置 `translate: true`，并确认 `translateProvider` 和 `translateModel` 已配置且允许发送 reasoning。

## 兼容性

- 当前仅验证 `@deepseek-ai/cordis` `4.0.1` 及 DSH `0.1.0-rc.7` 套件，Node.js `22.19.0` 和当前 24.x。
- DeepSeek Harness 仍处于 Developer Preview，可能出现破坏性 API 变更；升级 DSH 前请先在测试环境运行 `npm run verify`，并在 issue 中附上版本信息。
- 依赖 peer range 有意固定在已验证的 rc.7，兼容新版本后会在 changelog 中明确扩大范围。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `steering` | `both` | `off` / `system-section` / `first-step-reminder` / `both`，引导层挂载位置 |
| `translate` | `false` | 翻译层总开关；默认关闭以避免意外外发 reasoning |
| `translateProvider` | `deepseek-official` | 翻译调用的 provider 路由 |
| `translateModel` | `deepseek-v4-flash` | 翻译模型（建议廉价非思考路由） |
| `translateThinkingOff` | `true` | 翻译调用是否请求 `reasoningEffort: 'off'` |
| `cjkThreshold` | `0.3` | `[0, 1]`；未命中日文/繁体特征时，CJK 占比 ≥ 该值视为已是中文 |
| `maxCharsPerBlock` | `20000` | 正整数；超长 reasoning 立即停止缓冲并原文透传 |
| `timeoutMs` | `30000` | 正整数；单次翻译调用超时 |
| `maxOutputTokens` | `8192` | 正整数；翻译调用 `maxTokens` |
| `verbose` | `false` | 打印每次翻译的规模与耗时 |

以 DSH profile patch 管理插件配置时，挂载项应包含类似如下 `config`；请按自己的 provider/model 路由替换：

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

## 数据与语义边界

- 翻译调用使用完整 reasoning 作为输入，可能产生费用，并受 provider 的日志和保留策略约束；本插件不会替 provider 脱敏。
- 翻译发生在 agent-loop 落日志之前，因此成功译文会改变 session 日志、Web 回放和后续模型上下文；当前版本没有“仅 UI 翻译、原文持久化”模式。
- 输出会检查非空、结束原因、工具调用、长度扩张、代码围栏和中文内容；校验失败时保留原文。校验不能证明译文逐字准确，也不能完全阻止提示注入。
- `translate: false` 只保留零成本的中文引导层，不会发送额外 LLM 请求。

## 已知限制（v1）

- 仅面向简体中文；日文和常见繁体特征会转换，但仅由简繁共享汉字组成的句子无法可靠判别。
- 阈值内为整块延迟翻译；超阈值 reasoning 为原文实时透传。
- 不记录英文原文（外部插件追加自定义 session 事件会影响上游构建读取日志）。
- 不翻译最终回答。

## 开发

```sh
npm run build      # tsc -> lib/
npm test           # vitest 单测
npm run typecheck  # 含 tests 的严格类型检查
npm run smoke      # 真实 Cordis 上下文端到端冒烟（需先 build）
npm run package:check # 从 tarball 安装并导入包
npm run verify     # 无凭证的完整本地验证
```

支持 Node.js 22.19+（CI 同时验证当前 LTS）。运行翻译层需要 DSH 的 provider 路由和对应模型权限。

### 真实 provider 验证（仅维护者手动执行）

`npm run verify:real` 会向真实 provider 发送测试提示词和模型 reasoning，可能产生费用；它不会在 CI 中运行。先执行 `npm run build`，再显式提供路由和凭证环境变量：

```sh
VERIFY_PROVIDER=your-provider \
VERIFY_API_KEY_ENV=YOUR_PROVIDER_API_KEY \
VERIFY_BASE_URL=https://your-provider.example/v1 \
VERIFY_API=openai-completions \
VERIFY_MODEL=your-model \
npm run verify:real
```

将实际凭证仅放在 shell 环境中，不要写入 `.env`、配置文件或提交记录。该检查关闭 steering、强制启用翻译，并要求至少一次辅助翻译请求及最终 reasoning 通过中文门槛。

卸载：`dsh plugin --profile web remove dsh-reasoning-cn`。

GitHub 仓库建议添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic，便于 Harness 社区发现。

## License

MIT，见 [LICENSE](./LICENSE)。
