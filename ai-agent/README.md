# AI Agent — Kali Server Setup

Self-hosted AI memory for your trading system. **100% free** using Ollama.

## Recommended Model

| Your RAM | Model | Command |
|----------|-------|---------|
| 8 GB | Qwen2.5 3B | `ollama pull qwen2.5:3b-instruct` |
| **16 GB (recommended)** | **Qwen2.5 7B** | `ollama pull qwen2.5:7b-instruct` |
| 32 GB+ | Qwen2.5 14B or Llama 3.1 8B | `ollama pull qwen2.5:14b-instruct` |

**Why Qwen2.5 7B:** Best balance of reasoning, JSON output, and RAM usage for trade analysis and Telegram Q&A.

## Quick Install on Kali Linux

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull recommended model
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text

# Start server (accessible from your network)
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Or use Docker:

```bash
cd ai-agent
docker compose up -d
```

## How Learning Works

```
Trade Closes → Backend writes trade_lesson →
  Embedding via nomic-embed-text → Stored in Supabase (pgvector) →
  Next signal: query similar past setups → AI adjusts confidence note →
  Telegram Q&A: fetch pair_stats + lessons → Ollama answers from real data
```

### What Gets Stored After Each Trade

- Symbol, direction, outcome (win/loss)
- Setup description (MTF alignment, OB type)
- Lesson text (what worked / what failed)
- Tags for semantic search
- Updates `pair_stats.strategy_score` (+2 win, -3 loss)

### Example Questions You Can Ask via Telegram

- "Which pairs work best for my SMC strategy?"
- "Why did my last BTC trade fail?"
- "Should I trade ETH today based on my history?"
- "What's my win rate on SOLUSDT?"

## Configuration

Set in backend `.env`:

```
OLLAMA_URL=http://YOUR_KALI_IP:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
N8N_AI_WEBHOOK_URL=http://your-n8n:5678/webhook/ai-assistant
```

## System Prompt

See `prompts/trading-assistant.txt` — used by n8n AI workflow and backend `/api/ai/query`.

## Firewall

```bash
# Allow Ollama from your trading server only
ufw allow from YOUR_TRADING_SERVER_IP to any port 11434
```

## Verify

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b-instruct",
  "prompt": "Summarize: BTC win rate 65%, ETH 40%. Which is better?",
  "stream": false
}'
```

## Future Upgrades (Still Free)

1. **pgvector in Supabase** — semantic search over trade lessons
2. **Fine-tuning** — export winning setups as JSONL for local fine-tune
3. **RAG pipeline** — n8n fetches embeddings before Ollama call
