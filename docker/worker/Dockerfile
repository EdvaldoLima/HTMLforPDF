FROM node:20-bullseye

ARG RABBITMQ_URL

ENV RABBITMQ_URL=${RABBITMQ_URL}

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
RUN npx playwright install chromium --with-deps

# Copy source
COPY . .

# Worker only
CMD ["npm", "run", "worker"]
