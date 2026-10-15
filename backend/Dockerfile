# Paneltec Group — API server (FastAPI). Works on x86 and ARM (e.g. UGREEN NAS).
FROM python:3.11-slim

# WeasyPrint (PDFs) needs Pango/HarfBuzz and some fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 \
        fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY requirements.docker.txt .
RUN pip install --no-cache-dir -r requirements.docker.txt

COPY . .
RUN mkdir -p uploads/stock uploads/signatures

ENV PYTHONUNBUFFERED=1
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
