# MarkItDown Website Backend

Python FastAPI backend that integrates with the MarkItDown library to convert
various file formats (PDF, PowerPoint, Word, Excel, Images, Audio, HTML) to
Markdown.

## Project Structure

```
backend/
├── app/
│   ├── __init__.py          # Application package
│   ├── config.py            # Environment-driven configuration (Pydantic Settings)
│   ├── api/                 # FastAPI route handlers (tasks 3.x)
│   │   └── __init__.py
│   ├── models/              # Pydantic request/response models (task 1.3)
│   │   └── __init__.py
│   ├── services/            # Validation, file processing, cleanup (tasks 2.x, 13.x)
│   │   └── __init__.py
│   └── utils/               # Shared helpers and constants
│       └── __init__.py
├── requirements.txt         # Python dependencies
├── setup.py                 # Virtual environment + dependency setup script
├── .env.example             # Example environment configuration
└── .gitignore
```

## Requirements

- Python 3.9+

## Setup

Create the virtual environment and install dependencies:

```bash
# From the backend/ directory
python setup.py
```

Or manually:

```bash
# Windows
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Unix/Linux/Mac
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_FILE_SIZE` | `52428800` (50MB) | Maximum upload size in bytes |
| `CONVERSION_TIMEOUT` | `30` | Maximum conversion time in seconds |
| `MAX_CONCURRENT_CONVERSIONS` | `5` | Simultaneous conversions allowed |
| `REQUEST_TIMEOUT` | `120` | Safety-net per-request timeout in seconds (returns `504`). Keep larger than `CONVERSION_TIMEOUT`. |
| `HEALTH_CACHE_TTL` | `5` | Seconds to cache `/api/health` so disk/memory stats are not recomputed on every poll (`0` disables) |
| `TEMP_STORAGE_PATH` | `./temp` | Temporary file storage location |
| `RESULT_RETENTION_HOURS` | `1` | Hours to retain conversion results |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Allowed CORS origins |
| `RATE_LIMIT_PER_HOUR` | `100` | Requests per IP per hour |
| `AZURE_DI_ENDPOINT` / `AZURE_DI_KEY` | empty | Azure Document Intelligence (optional) |
| `AZURE_CU_ENDPOINT` / `AZURE_CU_KEY` | empty | Azure Content Understanding (optional) |
| `APP_NAME` | `MarkItDown Website API` | Application name |
| `APP_VERSION` | `0.1.0` | Application version |
| `DEBUG` | `false` | Enable debug mode |

## Running the Server

For local development (single process, auto-reload):

```bash
uvicorn app.main:app --reload
```

### Production: workers and connection handling

Uvicorn handles many concurrent connections on a single async event loop, so a
dedicated application-level connection pool is not required for inbound HTTP
traffic. To scale across CPU cores and serve more concurrent requests, run
multiple worker processes. Size the worker count to the host (a common starting
point is `2 x CPU cores + 1`):

```bash
# Built-in multi-worker mode
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

# Or run under Gunicorn with the uvicorn worker class (recommended for prod)
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000 \
    --timeout 180
```

Notes:

- `MAX_CONCURRENT_CONVERSIONS` bounds CPU-heavy conversions *per worker*; total
  concurrency is `workers x MAX_CONCURRENT_CONVERSIONS`. Tune both together.
- Keep the process/gateway timeout (e.g. Gunicorn `--timeout`) larger than
  `REQUEST_TIMEOUT` so the in-app `504` is returned before the worker is killed.
- Place a reverse proxy (nginx, ALB) in front to terminate TLS and reuse
  upstream keep-alive connections to the workers.
- Per-request response times are logged by `RequestLoggingMiddleware` (the
  `X-Process-Time-ms` response header and `<-- METHOD path STATUS ms` log line)
  for monitoring API latency.
