# AI Setup — Production Domains

## URLs

| Service | URL |
|---------|-----|
| AI Gateway (Ollama) | https://ai.deftluke.online |
| Backend context | https://api.deftluke.online |
| n8n AI webhook | https://n8n.deftluke.online/webhook/ai-assistant |

## Backend `.env`

```
AI_GATEWAY_URL=https://ai.deftluke.online
AI_GATEWAY_PUBLIC_URL=https://ai.deftluke.online
OLLAMA_URL=https://ai.deftluke.online
OLLAMA_VIA_GATEWAY=true
AI_API_KEY=your-key
```

## Kali AI gateway (systemd)

Ollama runs locally on Kali (`127.0.0.1:11434`). Public access is only via gateway:

```
BACKEND_URL=https://api.deftluke.online
OLLAMA_URL=http://127.0.0.1:11434
AI_API_KEY=your-key
```

Deploy:

```bash
scp -r ai-agent/gateway/* kali:~/ai-agent-gateway/
ssh kali 'AI_API_KEY=your-key bash ai-agent/configure-ai-subdomain.sh'
```

## Gateway endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | No |
| POST | `/chat` | X-API-Key |
| POST | `/lesson` | X-API-Key |
| GET | `/ollama/tags` | X-API-Key |
| POST | `/ollama/generate` | X-API-Key |
| POST | `/ollama/embeddings` | X-API-Key |

## Test

```bash
curl https://ai.deftluke.online/health

curl -X POST https://ai.deftluke.online/chat \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"question":"Which pair works best?"}'

curl https://api.deftluke.online/api/ai/health
```

## Models

Primary: `qwen2.5:7b-instruct`  
Fallback: `mistral:7b`  
Embeddings: `nomic-embed-text`
