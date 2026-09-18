# Worker service — Community Insights Dashboard
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend

# Backend source is mounted/copied into the image so handlers can import
# app.services.* — add it here if you bake the backend in, otherwise mount
# it at /app/backend via compose volumes during development.
WORKDIR /app/worker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

# Run as non-root
RUN useradd --create-home --uid 10001 appuser
USER appuser

# Healthcheck: heartbeat file touched at least once per poll cycle
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,sys,time; p=os.environ.get('WORKER_HEARTBEAT_PATH','/tmp/worker-heartbeat'); sys.exit(0 if os.path.exists(p) and time.time()-os.path.getmtime(p) < 120 else 1)"

CMD ["python", "worker.py"]
