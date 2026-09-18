FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt ./
ARG PIP_INDEX_URL=https://pypi.org/simple
# --network=host: buildkit's sandboxed network is pathologically slow on
# Docker Desktop; the host resolver pulls the same wheels orders of magnitude
# faster. Rebuild override:  docker compose build --build-arg PIP_INDEX_URL=...
RUN --network=host pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" -r requirements.txt

COPY app/ app/
COPY refresh.py ingest.py ./
RUN python -c "from app.main import app"

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]