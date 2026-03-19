# Contributing

感谢你愿意参与 `AI PR Helper`。

这个项目目前还处在早期阶段，欢迎任何能让它更稳定、更好用、更适合开源协作的改进，包括功能开发、Bug 修复、文档完善、测试补充和体验优化。

## 适合贡献的方向

- 修复 GitHub 页面兼容性问题
- 优化 PR 描述生成的 Prompt
- 拆分和重构当前前端逻辑
- 增加设置页和更多可配置项
- 提升错误提示和空状态体验
- 补充测试、文档和示例

## 本地开发

### 环境要求

- Node.js 18+
- npm
- Chromium 浏览器
- 可用的 AI API Key

### 安装依赖

```bash
npm install
```

### 配置环境变量

```bash
cp .env.example .env
```

填写：

```bash
PLASMO_PUBLIC_AI_API_KEY=your_api_key_here
PLASMO_PUBLIC_AI_BASE_URL=https://api.moonshot.cn/v1
PLASMO_PUBLIC_AI_MODEL=moonshot-v1-8k
```

默认值仍然兼容 Kimi；如果你接的是其他兼容 OpenAI Chat Completions 的服务，把地址和模型名替换掉即可。

### 启动开发

```bash
npm run dev
```

然后到浏览器扩展页面加载开发目录，例如：

```bash
build/chrome-mv3-dev
```

## 提交改动前建议

- 先确认改动是否符合当前项目目标：帮助 GitHub PR 更快生成高质量描述
- 尽量保持改动聚焦，一个 PR 只解决一类问题
- 如果改动涉及交互行为，请在 PR 描述中说明操作路径和预期效果
- 如果改动涉及 prompt 或输出格式，请提供前后对比示例
- 如果改动依赖 GitHub 页面 DOM，请说明测试过的页面类型

## Pull Request 建议

提交 PR 时，建议包含这些信息：

- 改动背景
- 解决的问题
- 实现方式
- 风险或兼容性影响
- 手动验证步骤

如果是 UI 或交互相关改动，最好补上截图或录屏。

## 代码风格

- 使用 TypeScript
- 保持实现直接、清晰，优先可读性
- 避免引入和当前项目规模不匹配的复杂抽象
- 在必要时补充简短注释，帮助后来者理解关键逻辑

## 沟通方式

如果你准备做较大的改动，建议先发一个 Issue 或先在 PR 中简单说明方案，避免和项目后续方向偏离太多。

小修复、小文档修改、拼写优化这类改动可以直接提交 PR。

## 目前特别欢迎的帮助

- 为不同类型的 PR 设计更稳的生成模板
- 增加对超长 Diff 的处理策略
- 补充自动化测试
- 降低前端直连模型 API 的安全风险
- 完善开源仓库基础设施，例如 `LICENSE`、Issue 模板、PR 模板
