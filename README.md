# RelateLab

RelateLab is an AI engineering workbench that turns relationship conversations into a structured case:

```text
text / chat screenshot
        |
     redaction
        |
 timeline extraction
        |
dynamics + safety agents
        |
 strategy generation
        |
 trace + evaluation + observability
```

The project is intentionally different from an AI companion application. It has no roleplay personas, intimacy systems, character cards, or social feed. The product surface is a desktop workbench for importing evidence, inspecting an agent run, comparing strategies, and evaluating model behavior.

## Stack

- React + Vite workbench
- Fastify API
- Node built-in SQLite persistence
- Zod contracts and structured model output validation
- OpenAI-compatible model gateway with a deterministic offline mode
- State-machine agent orchestrator
- Built-in evaluation runner
- Run traces with latency, token, cost, and failure metadata

## Run

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`.

The default `LLM_MODE=mock` runs the complete pipeline without network access. To use a real model, configure `.env`:

```text
LLM_MODE=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-key
LLM_MODEL=gpt-4.1-mini
```

`deepseek-flash` supports vision input, so a chat screenshot can be used as the only case input. The model reads visible text, speakers, and timestamps directly from the screenshot.

DeepSeek example:

```text
LLM_MODE=openai-compatible
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your-key
LLM_MODEL=deepseek-flash
LLM_SUPPORTS_VISION=true
```

## Commands

```powershell
npm run dev
npm run test
npm run build
npm run check
```

## API

- `GET /api/health`
- `POST /api/analyze`
- `GET /api/cases`
- `GET /api/cases/:id`
- `DELETE /api/cases/:id`
- `GET /api/runs/:id`
- `POST /api/evals/run`
- `GET /api/evals/latest`

## Architecture

See `docs/architecture.md` and `docs/roadmap.md`.

## Deploy with Render

The repository includes a `render.yaml` blueprint.

1. Push the repository to GitHub.
2. In Render, choose `New` -> `Blueprint`.
3. Select the GitHub repository.
4. Set the secret `LLM_API_KEY` when Render prompts for it.
5. Deploy and open the generated `onrender.com` URL.

The blueprint uses `/tmp/relatelab.sqlite`. Render's default container filesystem is ephemeral, so case history resets after a restart or redeploy. For persistent case history, attach a Render disk and set:

```text
SQLITE_PATH=/var/data/relatelab.sqlite
```

For a larger multi-user deployment, replace SQLite with PostgreSQL and add authentication, rate limiting, a Redis-backed job queue, and encrypted object storage.
