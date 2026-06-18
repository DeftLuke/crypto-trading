from collections.abc import AsyncGenerator

import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

_connect_args: dict = {}
if settings.database_requires_ssl:
    try:
        import certifi

        _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        _ssl_ctx = ssl.create_default_context()
    # Windows dev environments may lack full CA chain for Supabase pooler
    if settings.app_env != "production":
        _ssl_ctx.check_hostname = False
        _ssl_ctx.verify_mode = ssl.CERT_NONE
    _connect_args["ssl"] = _ssl_ctx

# Supabase transaction pooler (pgbouncer) requires disabled prepared statement cache
if "pooler.supabase.com" in settings.database_url:
    _connect_args["statement_cache_size"] = 0
    _connect_args["prepared_statement_cache_size"] = 0

engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    echo=settings.app_env == "development",
    connect_args=_connect_args,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
