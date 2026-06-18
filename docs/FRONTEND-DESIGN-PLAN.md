# TradeGPT — Unified Platform Design Plan

## Vision
One institutional-grade shell at `trade.deftluke.online`, with all tools in the left navigation, balance and account controls in the top bar, and a live homepage that shows which applications are running.

## Layout

```
Left tools nav | Top bar: balance · scanner · auto trade · account · settings
               | Page content: home cards, trading chart, or platform view
```

## Design System
- Font: Plus Jakarta Sans.
- Background: deep navy mesh gradient.
- Cards: glass surfaces, soft borders, hover lift, subtle glow.
- Status: green running, amber unknown/degraded, red live/danger.

## Production
Use:
- `VITE_API_URL=https://api.deftluke.online`
- `VITE_WS_URL=wss://api.deftluke.online`
- `VITE_APP_URL=https://trade.deftluke.online`
- `VITE_PLATFORM_URL=https://terminal.deftluke.online`

Docker adds `analytics-dashboard`, `research-api`, `redis`, and `qdrant`.
