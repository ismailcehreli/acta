# Tek imaj, iki süreç: web uygulaması ve arka plan işleyici (§17.2).
# Her ikisi de aynı kod tabanından çalışır, Compose'da farklı komutla başlatılır.

FROM node:22-bookworm-slim

# Prisma sorgu motoru OpenSSL'e bağımlıdır.
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

# Süreç doğrudan başlatılır (paket yöneticisi arada değil) ki SIGTERM
# uygulamaya ulaşsın ve kapanış temiz olsun.
CMD ["node_modules/.bin/next", "start"]
