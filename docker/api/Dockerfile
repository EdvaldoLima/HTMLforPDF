FROM node:20-bullseye

ARG PORT=3000
ARG RABBITMQ_URL

ENV PORT=${PORT}
ENV RABBITMQ_URL=${RABBITMQ_URL}

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
RUN npx playwright install chromium --with-deps

# Copy source
COPY . .

EXPOSE ${PORT}

# Allow running different npm scripts (default: start). At runtime set SERVICE=worker
# Example: `docker run -e SERVICE=worker ...`
CMD ["npm", "run", "start"]
