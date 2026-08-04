# Ozon Ops Dashboard

Ежедневная сводка Ozon для команды.

## Ссылка для чата

**https://wedoubledi-web.github.io/ozon-ops-dashboard/**

Обновляется автоматически каждый день ~07:00 МСК (GitHub Actions).

## Локальная сборка + публикация

```bash
python3 Бизнес/Маркетплейсы/Ozon/scripts/ozon_daily_ops.py
python3 Бизнес/Маркетплейсы/Ozon/scripts/publish_ops_dashboard.py
```

Или одной командой после сборки:

```bash
python3 Бизнес/Маркетплейсы/Ozon/scripts/publish_ops_dashboard.py --skip-build
```

## Secrets (GitHub → Settings → Secrets)

| Secret | Назначение |
|--------|------------|
| `OZON_CLIENT_ID` | Seller API |
| `OZON_API_KEY` | Seller API |
| `OZON_OPS_DEPLOY_TOKEN` или `OZON_FF_DEPLOY_TOKEN` | Push в pages-репозиторий |

## GitHub Pages

Репозиторий: `wedoubledi-web/ozon-ops-dashboard` (ветка `main`, source = root).
