# Platypus Backend (Modern Agentic API)

## Features
- Agentic API: Analyze code, stream reasoning/results.
- Modular, robust TypeScript + Express.
- Request validation and strong error handling.
- Plug-and-play for LLMs or custom agents.
- Health check, NDJSON streaming for VS Code extension.

## Requirements
- Node.js 18+
- npm

## Setup
```sh
cd backend
npm install
cp .env.example .env        # Create an env file, edit as needed
npm run dev                 # Start dev server at http://localhost:3001
```

## .env Example
```
PORT=3001
# AGENT_API_KEY=sk-...
```

## API
### Health Check
`GET /api/health`

### Analyze (Agent)
`POST /api/analyze`
```json
{
  "prompt": "Fix bug in A file.",
  "files": [
    { "filePath": "src/A.ts", "content": "..." }
  ]
}
```
- Streams NDJSON progress and final result.

## Extension Integration
- Extension should POST workspace state and prompt to `/api/analyze`.
- Listen for NDJSON streamed events (type: progress/result/error).
- Update UI with progress/reasoning.

## Dev Notes
- Extend agent pipeline in `src/routes/analyzeRoutes.ts` (`runAgent`).
- Add tools/services as needed for LLMs, planning, code search etc.

---
PRs and improvements welcome!
