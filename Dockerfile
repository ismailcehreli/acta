# One image, two processes: the web application and background worker (§17.2).
# Both run from the same codebase and start with different Compose commands.

FROM node:22-bookworm-slim

# The Prisma query engine depends on OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm prisma generate && pnpm build

EXPOSE 3000

# Start the process directly (without a package manager in between) so SIGTERM
# reaches the application and shutdown is clean.
CMD ["node_modules/.bin/next", "start"]
