FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY cloud.py makaron_relay.py ./
CMD ["sh", "-c", "exec uvicorn cloud:app --host 0.0.0.0 --port ${PORT:-8080} --no-access-log"]
