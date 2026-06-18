import asyncio
import argparse
import importlib.util
import os
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient

from api_client.main_trading_api import MainTradingApiClient
from parser.router import SignalParserRouter
from parser.store import JsonlSignalStore
from providers.config import load_providers


def _load_module(module_name: str, relative_path: str):
    module_path = Path(__file__).resolve().parent / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {relative_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_listener_class():
    return _load_module("telegram_signal_listener", "telethon/listener.py").TelegramSignalListener


def _load_dialog_sync():
    return _load_module("telegram_dialog_sync", "telethon/dialog_sync.py")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Telegram Signal Ingestion Service")
    parser.add_argument("--test-connection", action="store_true", help="Log in and verify the Telethon user session")
    parser.add_argument("--sync-dialogs", action="store_true", help="Store all accessible groups/channels in the main trading DB")
    parser.add_argument("--request-code", action="store_true", help="Send Telegram login code to the given phone")
    parser.add_argument("--login", action="store_true", help="Complete Telegram login with phone + code")
    parser.add_argument("--phone", default=os.getenv("TELEGRAM_PHONE", ""), help="Phone with country code, e.g. +8801...")
    parser.add_argument("--code", default=os.getenv("TELEGRAM_LOGIN_CODE", ""), help="Telegram verification code")
    parser.add_argument("--learn-formats", action="store_true", help="Scan followed groups and learn their signal message formats")
    parser.add_argument("--scrape-recent", action="store_true", help="Scrape recent messages from followed groups into the inbox")
    parser.add_argument("--scrape-limit", type=int, default=50, help="Messages to scan per group for --scrape-recent")
    parser.add_argument("--all-messages", action="store_true", help="Save all scanned messages instead of latest signal only")
    parser.add_argument("--password", default=os.getenv("TELEGRAM_2FA_PASSWORD", ""), help="Telegram 2FA password if enabled")
    return parser.parse_args()


async def _start_client() -> TelegramClient:
    load_dotenv()

    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        raise RuntimeError("TELEGRAM_API_ID and TELEGRAM_API_HASH are required")

    session_name = os.getenv("TELEGRAM_SESSION_NAME", "tradegpt_signal_ingestion")
    client = TelegramClient(session_name, int(api_id), api_hash)
    phone = os.getenv("TELEGRAM_PHONE") or None
    await client.connect()
    if not await client.is_user_authorized():
        if not phone:
            raise RuntimeError("Session not authorized. Run --request-code --phone +880... then --login --phone ... --code ...")
        await client.start(phone=phone)
    return client


async def main() -> None:
    args = _parse_args()
    load_dotenv()

    config_path = os.getenv("TELEGRAM_SERVICE_CONFIG", "./config.example.json")
    providers = load_providers(config_path)
    signal_store_path = os.getenv("SIGNAL_STORE_PATH", "./data/signals.jsonl")

    if args.request_code or args.login:
        login_mod = _load_module("telegram_login", "telethon/login.py")
        phone = (args.phone or "").strip()
        if not phone:
            raise RuntimeError("--phone is required (include country code, e.g. +8801...)")
        client = login_mod.create_client()
        result = await login_mod.login_with_code(
            client,
            phone=phone,
            code=(args.code or "").strip() or None,
            password=(args.password or "").strip() or None,
        )
        print(f"[SignalIngestion] Login result: {result}")
        if result.get("status") == "authorized":
            sync = _load_dialog_sync()
            api_client = MainTradingApiClient()
            sync_result = await sync.sync_dialog_sources(client, api_client)
            print(f"[SignalIngestion] Synced {sync_result['count']} groups/channels -> {sync_result['api_result']}")
        await client.disconnect()
        return

    client = await _start_client()
    api_client = MainTradingApiClient()

    if args.test_connection:
        me = await client.get_me()
        print(f"[SignalIngestion] Telethon connected as {getattr(me, 'username', None) or getattr(me, 'id', 'unknown')}")
        await client.disconnect()
        return

    if args.sync_dialogs:
        sync = _load_dialog_sync()
        result = await sync.sync_dialog_sources(client, api_client)
        print(f"[SignalIngestion] Synced {result['count']} groups/channels -> {result['api_result']}")
        await client.disconnect()
        return

    if args.learn_formats:
        format_learner = _load_module("telegram_format_learner", "telethon/format_learner.py")
        parser_router = SignalParserRouter()
        sources = await api_client.followed_sources()
        if not parser_router.ai_parser:
            raise RuntimeError("AI parser is disabled — set AI_PARSER_ENABLED=true")
        for source in sources:
            profile = await format_learner.learn_and_store_group_format(
                client,
                source,
                api_client,
                parser_router.ai_parser,
            )
            print(f"[SignalIngestion] {source.get('title')}: {profile.get('style')} — {profile.get('notes', '')[:120]}")
        await client.disconnect()
        return

    if args.scrape_recent:
        scraper = _load_module("telegram_history_scraper", "telethon/history_scraper.py")
        parser_router = SignalParserRouter()
        latest_only = not args.all_messages
        summary = await scraper.scrape_followed_groups(
            client,
            api_client,
            parser_router,
            limit=args.scrape_limit,
            learn_formats=not latest_only,
            latest_signal_only=latest_only,
        )
        print(f"[SignalIngestion] Scrape summary: {summary}")
        await client.disconnect()
        return

    if not providers:
        print("[SignalIngestion] No local providers configured. Using followed sources from backend.")

    listener_cls = _load_listener_class()
    listener = listener_cls(
        client=client,
        providers=providers,
        parser=SignalParserRouter(),
        api_client=api_client,
        store=JsonlSignalStore(signal_store_path),
    )
    await listener.refresh_followed_sources()
    listener.register()
    asyncio.create_task(listener.refresh_loop())

    print(f"[SignalIngestion] Providers: {', '.join(p.name for p in providers) or 'backend-followed-sources'}")
    print(f"[SignalIngestion] Followed sources from backend: {len(listener.followed_sources)}")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
