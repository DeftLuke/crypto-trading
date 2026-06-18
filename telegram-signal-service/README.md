# Telegram Signal Ingestion Service

Separate Telethon user-session service for collecting trading signals from Telegram channels/groups that your Telegram account is authorized to access.

This service only collects, parses, normalizes, stores, and forwards signals. It does not decide whether to trade and does not execute orders. Trade decisions stay inside the main trading backend.

## Flow

Telegram message -> provider parser -> normalized JSON -> local JSONL store -> `POST /api/external-signals/ingest`

The backend then runs SMC/indicator/risk validation and either:

- auto-executes through the existing trading engine when auto trading is enabled
- sends a Telegram notification with Execute/Skip buttons when auto trading is disabled
- rejects the signal when validation fails

## Setup

1. Create a Telegram API app at `https://my.telegram.org`.
2. Copy `.env.example` to `.env`.
3. Fill `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `MAIN_TRADING_API_URL`.
4. Copy `config.example.json` to `config.json` and add provider channel usernames or numeric chat IDs.
5. Install and start:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

On first run, Telethon will ask for your Telegram phone/login code and create a local session file.

## Provider Config

Each provider can have a different parser:

```json
{
  "id": "vip_channel_1",
  "name": "VIP_Channel_1",
  "enabled": true,
  "chats": ["VIP_Channel_1"],
  "parser": "generic"
}
```

Add provider-specific parsers in `providers/` and register them in `parser/router.py`.

## Normalized Payload

```json
{
  "provider": "VIP_Channel_1",
  "symbol": "BTCUSDT",
  "side": "LONG",
  "entry": 105000,
  "stop_loss": 103500,
  "take_profit": [106500, 108000, 110000],
  "raw_message": "...",
  "timestamp": "2026-06-17T14:00:00Z"
}
```

## AI Parser (text + chart vision)

- **Text signals:** AI classifies messages and extracts symbol, side, entry, SL, TP.
- **Chart signals:** When a message has a TradingView screenshot (e.g. `#HBAR buy here` + chart), the service downloads the image and sends it to the **vision model** (`AI_VISION_MODEL`, default `llava:7b`) via the AI gateway `POST /ollama/generate`.
- **Group format learning:** Followed groups are scanned (~40 recent messages) to learn each channel's signal style. Profiles are stored in `telegram_signal_sources.metadata.format_profile`.

### Required env

| Variable | Purpose |
|----------|---------|
| `AI_PARSER_URL` | Text parser endpoint (gateway `/chat`) |
| `AI_GATEWAY_URL` | Base URL for vision calls (`/ollama/generate`) |
| `AI_PARSER_MODEL` | Text model (e.g. `qwen2.5:7b-instruct`) |
| `AI_VISION_MODEL` | Vision model for chart screenshots (e.g. `llava:7b`) |

### Kali / Docker production

In `deploy/.env`:

```env
AI_PARSER_URL=http://host.docker.internal:8080/chat
AI_GATEWAY_URL=http://host.docker.internal:8080
AI_VISION_MODEL=llava:7b
```

Install the vision model once on the host:

```bash
ollama pull llava:7b
ollama list | grep llava
```

Then restart the scraper:

```bash
cd deploy
docker compose --profile telegram-ingestion up -d telegram-signal-service
docker inspect crypto-trading-telegram-signal-service-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep AI_VISION
```

Rule parsers run as fallback when AI is disabled or fails.

## Security

Use `EXTERNAL_SIGNAL_INGESTION_KEY` on the backend and the matching `MAIN_TRADING_API_KEY` in this service when exposing the endpoint outside localhost.
