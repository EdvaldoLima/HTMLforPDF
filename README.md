# HTMLforPDF

Generate PDFs from public URLs using [Playwright](https://playwright.dev/).
The Express API supports synchronous downloads and asynchronous jobs processed
by a RabbitMQ worker, with PDF delivery to an external webhook.

## Run with Docker

Requires Docker Engine and Docker Compose with profile support. Node.js and
Playwright are installed inside the application images.

```bash
cp .env.example .env
openssl rand -hex 32
```

Set `API_KEY` in `.env` to the generated value. The key must have at least 32
characters. Replace the example RabbitMQ password in both `RABBITMQ_PASSWORD`
and `RABBITMQ_URL` before starting a new bundled broker.

The example enables the bundled broker with `COMPOSE_PROFILES=rabbitmq`:

```env
COMPOSE_PROFILES=rabbitmq
RABBITMQ_USER=htmlforpdf
RABBITMQ_PASSWORD=<your-broker-password>
RABBITMQ_URL=amqp://htmlforpdf:<your-broker-password>@rabbitmq:5672
```

To use an existing broker instead:

```env
COMPOSE_PROFILES=
RABBITMQ_URL=amqp://user:password@your-broker-host:5672
```

Use an address reachable from the containers; `localhost` refers to each
container itself. Percent-encode special characters in URL credentials.

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api worker
```

The API is published at `http://localhost:3000` by default. `PORT` changes the
host port; the API still listens on port 3000 inside the container. The bundled
broker publishes AMQP on `127.0.0.1:5672` and its management UI on
`http://127.0.0.1:15672`, using the configured broker credentials.

Broker data persists in the `rabbitmq_data` volume. Default credentials apply
only when initializing a new volume. Changing environment values does not update
existing broker users. Disabling the profile does not stop a running broker:
use `docker compose stop rabbitmq` when switching, after draining pending jobs.
`docker compose down -v` deletes the broker volume and its data.

After code changes, use `docker compose up -d --build` to deploy the rebuilt
images. Restarting a container alone does not update its code.
See [Docker configuration](config/README.md) for more details.

## Run outside Docker

Requires Node.js >= 24, an accessible RabbitMQ broker for asynchronous jobs,
and Chromium with its system dependencies:

```bash
npm ci
npx playwright install chromium --with-deps
```

Create `.env` from `.env.example` if it does not exist and configure `API_KEY`.
Replace the Docker-only broker hostname `rabbitmq` with the broker address
reachable from your host. If using the bundled broker's default published port:

```env
RABBITMQ_URL=amqp://htmlforpdf:<your-broker-password>@127.0.0.1:5672
```

For development, run the API and worker in separate terminals:

```bash
npm run dev
npm run dev:worker
```

For compiled execution, build first, then run the API and worker in separate
terminals:

```bash
npm run build
npm start
npm run worker
```

Run Chromium as an unprivileged user on a host supporting its sandbox. The
application enables Chromium sandboxing explicitly. `COMPOSE_PROFILES` controls
Docker Compose only; it does not start a broker when running npm commands.

## Configuration

The application loads `.env`. Defaults below are the application defaults when
variables are absent; `.env.example` enables the bundled broker and supplies its
Docker URL instead of the application's `amqp://localhost` fallback.
Numeric settings must be positive integers within the bounds in
[src/config/env.ts](src/config/env.ts).

| Variable                 | Default               | Purpose                                                        |
| ------------------------ | --------------------- | -------------------------------------------------------------- |
| `PORT`                   | `3000`                | API port outside Docker; published host port with Compose      |
| `API_KEY`                | None; required        | Shared API key, at least 32 characters; send as `X-API-Key`    |
| `RABBITMQ_URL`           | `amqp://localhost`    | Broker connection URL; supports `amqps://`                     |
| `PDF_QUEUE_NAME`         | `html_for_pdf_job_v2` | Main queue name; must match between API and worker             |
| `WORKER_CONCURRENCY`     | `1`                   | Worker prefetch; must not exceed `MAX_CONCURRENT_RENDERS`      |
| `MAX_CONCURRENT_RENDERS` | `2`                   | Maximum simultaneous renderings per process                    |
| `RENDER_TIMEOUT_MS`      | `45000`               | Total render deadline, including DNS and browser startup       |
| `WEBHOOK_TIMEOUT_MS`     | `15000`               | Deadline for each webhook delivery                             |
| `MAX_PDF_BYTES`          | `20971520`            | Maximum PDF size, checked after generation (20 MiB)            |
| `MAX_NETWORK_BYTES`      | `52428800`            | Network traffic budget per render (50 MiB)                     |
| `MAX_NETWORK_REQUESTS`   | `500`                 | Per-render limits for resources and proxy requests/tunnels     |
| `JOB_MAX_ATTEMPTS`       | `3`                   | Total processing attempts, including the first                 |
| `QUEUE_MAX_LENGTH`       | `10000`               | Message-count limit for each main, retry and dead-letter queue |
| `RATE_LIMIT_PER_MINUTE`  | `30`                  | PDF requests per source IP per API process                     |
| `WEBHOOK_SECRET`         | Empty                 | Optional shared secret for HMAC-SHA256 delivery signatures     |
| `LOG_LEVEL`              | `info`                | `debug`, `info`, `warn`, or `error`                            |

Docker-only settings:

| Variable                   | Value in `.env.example`      | Purpose                                                       |
| -------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `COMPOSE_PROFILES`         | `rabbitmq`                   | Starts the bundled broker; leave empty for an external broker |
| `RABBITMQ_USER`            | `htmlforpdf`                 | Initial bundled broker username                               |
| `RABBITMQ_PASSWORD`        | `change-me-local-only`       | Initial bundled broker password; replace before deployment    |
| `RABBITMQ_PORT`            | `5672`                       | AMQP host port, bound to loopback                             |
| `RABBITMQ_MANAGEMENT_PORT` | `15672`                      | Management UI host port, bound to loopback                    |
| `ENV_FILE`                 | Not set; Compose uses `.env` | Container environment file path                               |

`ENV_FILE` selects the service environment file, not Compose's interpolation
file. To use another file consistently, for example:

```bash
ENV_FILE=.env.production docker compose --env-file .env.production up -d --build
```

## API

Base path: `/api/pdfs`. Both POST routes require `X-API-Key: <your-api-key>` and
`Content-Type: application/json`. The JSON body limit is 100 KiB. Responses
include `X-Request-Id` and `Cache-Control: no-store`.

### Generate a PDF synchronously

`POST /api/pdfs` accepts a required `url` and optional `options`:

```json
{
  "url": "https://example.com",
  "options": {
    "format": "A4",
    "landscape": true,
    "margin": { "top": "2cm", "bottom": "2cm" }
  }
}
```

```bash
curl http://localhost:3000/api/pdfs \
  -H 'X-API-Key: <your-api-key>' \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com","options":{"format":"A4"}}' \
  --output document.pdf
```

Success returns `200`, `Content-Type: application/pdf`, and
`Content-Disposition: attachment; filename="file.pdf"`.

### Queue a PDF job

`POST /api/pdfs/jobs` additionally requires `webhookUrl`:

```json
{
  "url": "https://example.com",
  "webhookUrl": "https://your-server.example/webhook/pdf",
  "options": { "format": "A3", "printBackground": true }
}
```

After confirmed publication and successful routing, the response is `202`:

```json
{ "status": "queued", "jobId": "<uuid>" }
```

This acknowledges queue acceptance, not PDF delivery. The API does not provide
a persistent job-status endpoint. The worker must be running to process jobs.

### Error responses

| Status | Meaning                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| `400`  | Malformed request body                                                                                       |
| `401`  | Missing or invalid API key                                                                                   |
| `413`  | Request body exceeds the limit                                                                               |
| `415`  | Unsupported body encoding                                                                                    |
| `422`  | Invalid fields/options, blocked destination, permanent source error, or render size/network limits           |
| `429`  | API rate limit exceeded                                                                                      |
| `500`  | Unexpected internal failure                                                                                  |
| `503`  | Render capacity exhausted, temporary DNS/source failure, queue unavailable, or authentication not configured |
| `504`  | Render deadline or browser operation timeout                                                                 |

Schema validation returns an `errors` array, for example:

```json
{
  "errors": [
    {
      "field": "options.pageRanges",
      "message": "The pageRanges must contain positive, ascending page ranges, e.g. \"1-5, 8\"",
      "rule": "pageRanges"
    }
  ]
}
```

Public processing errors use `{ "error": "<safe message>" }`. Unexpected failures
use a generic message and request ID. Internal browser logs are not sent to the
client. Rate-limit responses use the middleware's response format.

### Health endpoints

- `GET /health/live`: unauthenticated process liveness check.
- `GET /health/ready`: requires `X-API-Key`; returns `200` if the broker connection
  and queue topology are available, otherwise `503`. It does not launch Chromium
  or check that a worker is consuming.

## PDF options

All fields are optional. `printBackground` defaults to `true`; paper defaults to
A4 when custom dimensions are absent.

| Field                 | Type               | Description                                                                         |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `scale`               | `number`           | Finite value from 0.1 to 2; default 1                                               |
| `displayHeaderFooter` | `boolean`          | Display header/footer; default false                                                |
| `headerTemplate`      | `string`           | Header HTML, up to 10000 characters                                                 |
| `footerTemplate`      | `string`           | Footer HTML, up to 10000 characters                                                 |
| `printBackground`     | `boolean`          | Print background graphics; default true                                             |
| `landscape`           | `boolean`          | Landscape orientation; default false                                                |
| `pageRanges`          | `string`           | Positive pages/ascending ranges, e.g. `"1-5, 8"`; empty means all pages             |
| `format`              | `string`           | Paper format; mutually exclusive with custom dimensions                             |
| `width`               | `string \| number` | Custom width; numbers are pixels                                                    |
| `height`              | `string \| number` | Custom height; numbers are pixels                                                   |
| `margin`              | `object`           | Optional `top`, `right`, `bottom`, `left`; each is a string or number; default zero |
| `preferCSSPageSize`   | `boolean`          | Give page CSS `@page` size priority; default false                                  |
| `tagged`              | `boolean`          | Generate accessibility tags; default false                                          |
| `outline`             | `boolean`          | Generate document outline; default false                                            |

Accepted formats (case-sensitive): `Letter`, `Legal`, `Tabloid`, `Ledger`, `A0`,
`A1`, `A2`, `A3`, `A4`, `A5`, `A6`.

Validation is shared by both routes and the worker:

- Unknown keys in `options` or `margin`, explicit `null`, and wrong JSON types
  are rejected. Booleans such as `"false"` and numeric strings such as
  `scale: "1"` are not coerced. Filesystem output through `path` is not allowed.
- Dimensions accept finite numbers or strings with `px`, `in`, `cm`, or `mm`
  and up to two decimal places. Values are bounded to 5000px after conversion;
  custom paper dimensions must be at least 1px and leave at least one print point
  of content. Margins can be zero.
- Use `format` or custom `width`/`height`, not both. If one custom dimension is
  absent, it uses the corresponding A4 value: width `8.27in`, height `11.7in`.
- Opposite margins must leave printable space for the effective paper size and
  orientation. CSS page sizing and the page's layout still affect rendering.
- `pageRanges` is limited to 1000 characters. Zero, reversed ranges such as
  `2-1`, malformed syntax, and indexes above 4294967295 are rejected before
  generation. Compatibility with the actual page count is determined during
  rendering; a page-count failure returns a safe `422`.
- URLs are limited to 2048 characters. Invalid options fail before Chromium is
  launched or a job is published.

Header/footer templates support classes `date`, `title`, `url`, `pageNumber`,
and `totalPages` for injected values. Page styles are not inherited by these
templates and template scripts are not evaluated by Playwright. The validator
checks strings and limits, not the resulting HTML layout.

Navigation waits for `load`. Content loaded later by an SPA may not appear in
the PDF; there is no custom readiness-selector option.

## External webhook delivery

The worker sends the PDF with:

| Item                  | Value                                              |
| --------------------- | -------------------------------------------------- |
| Method                | `POST`                                             |
| Content type          | `multipart/form-data`                              |
| File field            | `file`                                             |
| Filename              | `file.pdf`                                         |
| File MIME type        | `application/pdf`                                  |
| `X-Job-Id`            | Job UUID                                           |
| `Idempotency-Key`     | Same job UUID                                      |
| `X-Webhook-Timestamp` | Unix timestamp in seconds                          |
| `X-Webhook-Signature` | Hex HMAC-SHA256, only when `WEBHOOK_SECRET` is set |

Any HTTP `2xx` response counts as successful delivery; no response-body format
is required. Other statuses, connection failures and timeouts are delivery
failures. Redirects are rejected. The project does not include a webhook receiver;
provide your own externally reachable endpoint.

When `WEBHOOK_SECRET` is set, the signature covers the UTF-8 string
`timestamp + "." + jobId + "."` followed by the raw PDF bytes. Validate against
the extracted multipart file, not the complete multipart body. Receivers should
compare signatures in constant time, enforce a timestamp freshness window, and
persist processed job IDs to deduplicate deliveries.

## Queue behavior

The main queue is `PDF_QUEUE_NAME`, with `<queue>.retry` and `<queue>.dead`
companions. Queues are durable, published jobs are persistent, and each queue
is bounded by `QUEUE_MAX_LENGTH` with overflow rejection.

A job is acknowledged after successful delivery or confirmed publication to
the retry queue. Transient processing errors and webhook delivery failures are
retried after a fixed 30-second TTL, up to `JOB_MAX_ATTEMPTS` total attempts.
The last failure is dead-lettered. Malformed jobs and permanent rendering/input
errors (`422`) go directly to `.dead`. Source HTTP 408/429/5xx and temporary DNS
failures remain retryable. The worker reconnects after channel/connection failures
and waits for the previous channel's jobs to settle before consuming again.

Jobs in `.dead` are not replayed automatically if the webhook recovers. Monitor
the queue and arrange replay after resolving the failure. PDFs are kept in
memory, not archived: retry renders the source again and may produce a different
file. Delivery can repeat after a crash between webhook acceptance and job
acknowledgement. A second API submission creates a separate job.

Classic queue dead-letter transfers are not transactional delivery guarantees
when the destination/broker is unavailable. Stronger requirements need a planned
quorum-queue migration with at-least-once dead-lettering. Monitor dead-letter
capacity as well as the main and retry queues.

### Migrating an existing queue

API and worker must use the same queue name and limits. Queues declared with
different arguments cannot be redeclared in place. Drain existing jobs with a
compatible worker, then select a new queue name for the updated topology.
Older payloads without the required UUID `jobId` are not valid for the current
worker. Preserve existing data; do not delete queues containing pending jobs.

## Security and deployment

Only public HTTP/HTTPS destinations on ports 80 and 443 are accepted for source
and webhook URLs. URL credentials, private/reserved IPv4/IPv6 addresses and DNS
results containing private addresses are rejected. Source redirects and
subresources use the same validated-IP proxy policy. Internal dashboards and
localhost/private webhook receivers are blocked.

Chromium runs sandboxed in an isolated instance per render. Service workers,
downloads and WebSockets are disabled. The proxy limits simultaneous client
connections to 64 and enforces request/traffic budgets. A render exceeding a
network budget fails with `422` instead of returning a PDF with resources cut
off by that budget. Traffic accounting includes request bytes and received HTTP
body/encrypted HTTPS tunnel bytes, not expanded page memory.

Application containers run as `node`, with a read-only filesystem, temporary
writable storage, dropped capabilities, and the Chromium seccomp profile. Docker
builds use `npm ci` and a TypeScript build stage; secrets are supplied at runtime
and `.env` files are excluded from the build context. The bundled RabbitMQ has
its own service settings and persistent writable volume.

Default application-container limits are 1 GiB memory, 2 CPUs, 256 processes/threads,
256 MiB shared memory, and a 512 MiB temporary filesystem. Raising application
concurrency or size limits does not raise Docker limits. PDF size is checked
after generation, so container memory limits remain necessary while rendering.
The Compose shutdown grace period is 90 seconds; adjust it if increasing render
or webhook deadlines beyond that budget.

Keep the Chromium sandbox enabled on a suitable host and restrict outbound
traffic in the deployment infrastructure. Terminate TLS at a gateway, keep the
API key out of client-side applications, and use restricted broker credentials
and `amqps://` across untrusted networks.

Authentication uses one shared key. Rate limits and concurrency are per process;
distributed quotas and tenant authorization require shared infrastructure.
`X-Forwarded-For` is not blindly trusted: configure gateway limits when deploying
behind a reverse proxy.

Logs are JSON with request/job IDs and sensitive-field redaction. Graceful
shutdown stops intake and allows in-flight processing within a bounded deadline.
Monitor render failures, queue age/depth, dead letters, and container resources.

## Scripts and checks

```bash
npm run dev          # API with automatic restart
npm run dev:worker   # Worker with automatic restart
npm run typecheck    # TypeScript checks for application and tests, without output
npm run build        # Compile src into dist
npm start            # Run compiled API; build first
npm run worker       # Run compiled worker; build first
npm run lint         # ESLint for src and tests
npm run lint:fix     # Apply ESLint fixes
npm run format       # Prettier
npm test             # Run tests once
npm run test:watch   # Watch tests
npm audit            # Audit npm dependencies
```

Tests cover validation, authentication, SSRF policy, proxy limits, browser
cleanup/timeouts/concurrency, publisher confirms/routing, retry/dead-letter
behavior and webhook signing. npm audit does not scan OS packages or Chromium.

See the [technical review](docs/revisao-tecnica.md) for reviewed risks and remaining
architecture decisions, including persistent job status, PDF storage, delivery
guarantees, deduplication and distributed quotas.

## License

ISC — [Edvaldo Lima](https://github.com/EdvaldoLima)
