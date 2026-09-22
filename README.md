# RelateLab

[在线体验](https://relatelab-ai.onrender.com) · [GitHub Actions](https://github.com/mengchenxin/relatelab-ai/actions/workflows/ci.yml)

![CI](https://github.com/mengchenxin/relatelab-ai/actions/workflows/ci.yml/badge.svg)

RelateLab 是一个面向真实人际关系问题的 AI 工程工作台。

用户不需要整理或输入聊天记录，只需要上传一张聊天截图。系统会读取截图中的消息、说话人与时间，重建聊天记录，并在每条消息下面显示 AI 解读、潜在需求、沟通信号和建议动作。

## 核心功能

- 聊天截图直接输入，无需手工填写对话记录
- 支持一次上传最多 6 张截图，并按顺序重建聊天记录
- 使用 `deepseek-flash` 视觉能力识别截图内容
- 按左右聊天气泡重建聊天记录
- 每条消息下方显示 AI 解读、情绪、需求、行动建议和置信度
- 用户可以直接修正识别错误的文字、说话人和时间
- 分析要求与撤退、指责与防御等关系互动模式
- 生成三种沟通策略，并说明适用条件、风险和证据
- 对自伤、威胁、暴力、控制性表达进行安全分级
- 保存案例、加载历史案例和二次确认删除
- 记录每个 Agent 的模型、耗时、Token、输出摘要和降级状态
- 内置评测集，覆盖结构契约、安全性、证据引用、策略多样性和脱敏
- 支持每个用户配置自己的 DeepSeek API Key，不共享部署方密钥
- 使用签名 HttpOnly 会话 Cookie 隔离不同用户的案例数据
- 支持隐私同意、数据保留期限、一键删除全部数据和单个案例删除
- 对分析请求限流，并校验截图 MIME、文件签名和大小
- 支持 SQLite 本地开发与 PostgreSQL 生产持久化
- 支持回填策略是否采用、对方回应、冲突变化和备注，形成结果闭环
- 记录 Prompt、Schema 和 Provider 归一化版本

## 整体流程

```text
聊天截图
   |
视觉识别与隐私脱敏
   |
事件时间线提取
   |
关系动态分析
   |
安全风险判断
   |
沟通策略生成
   |
聊天记录回放 + Agent Trace + 评测
```

## 技术栈

- React + Vite
- TypeScript
- Fastify
- Zod 契约与结构化输出校验
- DeepSeek OpenAI 兼容接口
- Node 内置 SQLite
- Docker
- GitHub Actions
- Render

## BYOK 密钥模式

生产环境使用 BYOK，即 Bring Your Own Key：

1. 用户打开在线页面。
2. 在“DeepSeek API Key”输入框中填写自己的 Key。
3. Key 只保存在当前浏览器的 `sessionStorage`。
4. 分析时 Key 通过 `x-llm-api-key` 请求头临时发送给后端。
5. 后端不把 Key 写入数据库、Trace、案例库或日志。
6. 关闭标签页或浏览器后，Key 自动清除。

部署方不要在 Render 中配置共享的 `LLM_API_KEY`。后端通过以下变量强制要求用户自带 Key：

```text
LLM_ENFORCE_BYOK=true
```

如果要求后端永远看不到用户 Key，需要改为浏览器直接调用 DeepSeek，或使用纯本地运行版本。

完整的用户数据说明见 [`public/privacy.html`](public/privacy.html)。

## 本地运行

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

默认配置使用 `mock` 模式，可以在不调用模型的情况下运行完整流程。

使用 DeepSeek 视觉模型时，`.env` 可以配置为：

```text
LLM_MODE=openai-compatible
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
LLM_SUPPORTS_VISION=true
LLM_ENFORCE_BYOK=true
LLM_API_KEY=
```

然后在网页中填写用户自己的 DeepSeek Key。

## 测试与构建

```powershell
npm test
npm run build
npm run check
```

当前包含 14 个测试，覆盖：

- 案例运行、列表、历史加载和删除
- BYOK 缺失用户 Key 时拒绝分析
- 聊天时间线提取
- 关系互动模式识别
- 安全风险分级
- DeepSeek 输出归一化
- 隐私脱敏
- 匿名会话签名与篡改校验
- 不同会话之间的案例隔离
- 截图格式与文件签名校验
- 分析请求限流
- 多截图输入
- 消息识别纠错
- 策略结果回填

## API

- `GET /api/health`
- `POST /api/analyze`
- `GET /api/cases`
- `GET /api/cases/:id`
- `PATCH /api/cases/:caseId/events/:eventId`
- `DELETE /api/cases/:id`
- `POST /api/cases/:caseId/outcomes`
- `GET /api/cases/:caseId/outcomes`
- `GET /api/runs/:id`
- `POST /api/evals/run`
- `GET /api/evals/latest`

## Render 部署

仓库包含 `render.yaml`：

1. 将代码推送到 GitHub。
2. 在 Render 选择 `New` -> `Blueprint`。
3. 选择仓库 `mengchenxin/relatelab-ai`。
4. Render 自动读取 `render.yaml` 并创建 Docker Web Service。
5. 不要配置共享的 `LLM_API_KEY`。
6. 部署完成后打开生成的 `onrender.com` 地址。

Render 免费实例在一段时间无访问后会休眠，首次打开可能需要等待。默认 SQLite 文件位于临时文件系统，重新部署后案例历史会重置。

如果需要持久保存案例，可以挂载 Render Disk 并配置：

```text
SQLITE_PATH=/var/data/relatelab.sqlite
```

生产环境更推荐配置 PostgreSQL：

```text
DATABASE_URL=postgresql://user:password@host:5432/database
SESSION_SECRET=使用 Render 自动生成的高强度随机值
DATA_RETENTION_DAYS=30
```

配置 `DATABASE_URL` 后，系统会自动使用 PostgreSQL，并在启动时执行基础表结构迁移。

## 项目定位

RelateLab 不是 AI 情感陪伴产品，也不是心理治疗或医疗诊断工具。

它解决的是更具体的问题：当真实关系中出现冲突、误解、边界或沟通困难时，帮助用户把混乱的信息转成可追踪的证据、结构化分析、安全判断和可执行沟通策略。

---

## English Summary

RelateLab is an AI engineering workbench for real-world relationship cases.

Users upload a chat screenshot without manually entering the conversation. `deepseek-flash` reads the screenshot, reconstructs the chat, and inserts inline AI analysis beneath each message. The system then extracts a timeline, analyzes interaction patterns, performs safety triage, and generates three evidence-linked communication strategies.

The project includes structured output validation, provider-specific normalization, retries, deterministic fallback, SQLite persistence, case loading and deletion, evaluation, and agent-level observability.

Production uses BYOK: each user supplies their own DeepSeek API key in the browser. The key is stored in `sessionStorage`, sent only with the analysis request, and is not persisted in SQLite, traces, or logs.

Stack: React, Vite, TypeScript, Fastify, Zod, SQLite, Docker, DeepSeek, Render, and GitHub Actions.
