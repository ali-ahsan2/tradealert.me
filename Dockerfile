FROM python:3.12-slim

WORKDIR /app

# PIP_FIND_LINKS builds offline from a local wheelhouse (fast on Docker
# Desktop, where BuildKit networking is throttled); otherwise install from
# the index. PUT WHEELS INTO ./wheelhouse to build offline, or leave empty.
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_FIND_LINKS=
COPY requirements.txt ./
COPY wheelhouse/ ./wheelhouse/
RUN if [ -n "$PIP_FIND_LINKS" ]; then \
      pip install --no-cache-dir --no-index --find-links "$PIP_FIND_LINKS" -r requirements.txt; \
    else \
      pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r requirements.txt; \
    fi

COPY app/ app/
COPY db/migrate.py db/migrate.py
COPY db/migrations/ db/migrations/
COPY db/seed_lab.py db/seed_lab.py
COPY refresh.py ingest.py ./
COPY static/ static/
RUN python -c "from app.main import app"

EXPOSE 8000
CMD ["sh", "-c", "python db/migrate.py && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"]