# Deployment / Docker configuration

This folder contains Docker-related configuration for local development and simple deployments.

Files:
- `docker/Dockerfile` — Dockerfile to build the application image (runs `npm start`).
- `docker-compose.yml` — Compose file (moved to project root) to start the `api` service. RabbitMQ is expected external; set `RABBITMQ_URL` in project `.env`.
- `docker/.env.example` — Example environment variables for Docker.

Quick start:

1. Copy Docker env example:

```bash
cp docker/.env.example .env
```

2. Build and start with compose:

```bash
docker compose -f docker/docker-compose.yml up --build
```
