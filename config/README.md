# Deployment configuration

Dockerfiles are in `docker/api/Dockerfile` and `docker/worker/Dockerfile`.
The Compose file is `docker-compose.yml` in the project root.

1. Copy `.env.example` to `.env`.
2. Configure `API_KEY`, the external `RABBITMQ_URL`, and matching queue settings.
3. Run `docker compose up --build` from the project root.

See the root README for security boundaries, queue migration, webhook signing,
health endpoints and operational limits. `docker/chromium-seccomp.json` is the
Playwright seccomp profile adapted from
https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json.
