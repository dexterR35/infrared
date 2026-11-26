FROM node:24-bookworm-slim AS frontend
WORKDIR /srv/infrared
COPY package*.json ./
RUN npm ci
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY tsconfig.json vite.config.ts ./
COPY config config
COPY docs docs
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 tesseract-ocr && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/infrared
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend /srv/infrared ./
RUN python -m venv /opt/models && /opt/models/bin/pip install --no-cache-dir -r apps/intelligence/requirements.txt && python -m venv /opt/research && /opt/research/bin/pip install --no-cache-dir -r apps/intelligence/research/requirements.txt
RUN useradd --uid 10001 --create-home infrared && mkdir -p /var/lib/infrared && chown infrared /var/lib/infrared
ENV DATA_DIR=/var/lib/infrared INFRARED_INTELLIGENCE_PYTHON=/opt/models/bin/python INFRARED_RESEARCH_PYTHON=/opt/research/bin/python BIND_HOST=0.0.0.0
USER infrared
CMD ["node","--import","tsx","apps/server/main.ts"]
