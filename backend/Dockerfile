FROM python:3.12.3-slim-bookworm

# poetry.lock uses lock-version 2.1, which requires Poetry 2.x.
ENV POETRY_VERSION=2.1.3 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_NO_INTERACTION=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7001 \
    LOCAL_ASSET_DIR=/app/local_assets

RUN pip install --no-cache-dir "poetry==$POETRY_VERSION"

WORKDIR /app

# Copy only dependency manifests first to cache the install layer.
COPY poetry.lock pyproject.toml /app/
RUN poetry install --without dev --no-root

# Chromium + Linux libraries needed by the Playwright screenshot preview tool.
RUN playwright install --with-deps chromium

COPY ./ /app/
RUN mkdir -p "$LOCAL_ASSET_DIR"

EXPOSE 7001

# Hosting platforms (Render, Railway, Fly, Cloud Run) inject $PORT.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7001} --proxy-headers --forwarded-allow-ips='*'"]
