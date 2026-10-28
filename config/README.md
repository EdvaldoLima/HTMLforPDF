# Deployment configuration

Dockerfiles are in `docker/api/Dockerfile` and `docker/worker/Dockerfile`.
The Compose file is `docker-compose.yml` in the project root.

1. Copy `.env.example` to `.env`.
2. Configure `API_KEY`, `RABBITMQ_URL`, and matching queue settings.
3. Run `docker compose up --build` from the project root.

## Bundled RabbitMQ

Set these values in `.env` (replace the example password in both places):

```env
COMPOSE_PROFILES=rabbitmq
RABBITMQ_USER=htmlforpdf
RABBITMQ_PASSWORD=change-me-local-only
RABBITMQ_URL=amqp://htmlforpdf:change-me-local-only@rabbitmq:5672
```

Run `docker compose up -d --build`. The broker, API and worker start together.
The worker retries its connection while the broker initializes. The broker has
a health check; API readiness remains unavailable until the broker accepts connections.
The management UI is available at `http://localhost:15672`, using the configured
username and password. Both published ports bind only to `127.0.0.1`.
`RABBITMQ_PORT` and `RABBITMQ_MANAGEMENT_PORT` change host ports; containers
continue to connect to `rabbitmq:5672`.

Messages and broker configuration persist in the `rabbitmq_data` volume across
restarts. Default credentials initialize a new volume only: changing these
environment variables does not change users in an existing broker. Update users
through RabbitMQ administration when reusing a volume. Percent-encode special
characters in credentials embedded in `RABBITMQ_URL`.

## Existing RabbitMQ

```env
COMPOSE_PROFILES=
RABBITMQ_URL=amqp://user:password@your-broker-host:5672
```

Run the same `docker compose up -d --build` command. Only API and worker start;
neither depends on the bundled service. Use an address reachable from containers:
`localhost` points to the container itself, not the Docker host.

When switching from the bundled broker to an existing one, first run
`docker compose stop rabbitmq`, then clear the profile and change the URL.
Disabling a profile does not stop a container that is already running. Drain
pending jobs before switching brokers. Keep the volume to preserve existing data;
`docker compose down -v` deletes it.

See the root README for security boundaries, queue migration, webhook signing,
health endpoints and operational limits. `docker/chromium-seccomp.json` is the
Playwright seccomp profile adapted from
https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json.
