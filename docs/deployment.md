# Acta Production Deployment Guide

This guide covers deploying Acta in a secure, production-ready environment using Docker Compose and a reverse proxy.

---

## 🔒 Security Architecture

In accordance with enterprise security standards:
* **Localhost Binding:** In `docker-compose.yml`, all database and application ports bind strictly to `127.0.0.1`. No container port is exposed directly to the public internet.
* **TLS Termination:** All public traffic must be routed through a reverse proxy (e.g., Caddy, Nginx, or Traefik) terminating HTTPS with modern TLS (TLS 1.2+ / 1.3).
* **Environment Secrets:** Secrets (`APP_SECRET`, database passwords, SMTP credentials) must be configured in `.env` and kept strictly confidential.

---

## 📋 Prerequisites

* Linux Server (Ubuntu 22.04 / 24.04 LTS, Debian 12, or AlmaLinux 9 recommended)
* Docker (Engine >= 24.0) & Docker Compose (Plugin >= 2.20)
* A registered domain name pointing to your server IP (e.g. `acta.example.com`)

---

## 🚀 Step-by-Step Deployment

### 1. Clone the Codebase
```bash
cd /opt
git clone https://github.com/ismailcehreli/acta.git
cd acta
```

### 2. Configure Environment Variables
Create your production `.env` file:
```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env` and configure:
```ini
# Production Environment
NODE_ENV=production

# Database Credentials (use strong random passwords)
POSTGRES_USER=acta_admin
POSTGRES_PASSWORD=generate_a_strong_password_here
POSTGRES_DB=acta_production

# Application Secret: Must be at least 32 characters
APP_SECRET=generate_a_64_character_random_hex_string_here

# Base URL for public access
APP_BASE_URL=https://acta.example.com
```

> **Tip:** You can generate a strong `APP_SECRET` using:
> ```bash
> openssl rand -base64 32
> ```

### 3. Start the Application Stack
```bash
docker compose up --build -d
```

Verify services are running:
```bash
docker compose ps
```
You should see `postgres`, `app`, and `worker` in `healthy` or `running` state.

### 4. Initialize Root Administrator
Run the one-time root account generator:
```bash
docker compose exec app pnpm setup
```
Save the printed temporary credentials in a secure password manager.

---

## 🌐 Reverse Proxy Setup (HTTPS)

### Option A: Caddy (Recommended - Automatic SSL)
Caddy automatically manages Let's Encrypt certificates:

```caddyfile
# /etc/caddy/Caddyfile
acta.example.com {
    reverse_proxy 127.0.0.1:3000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

### Option B: Nginx with Certbot
```nginx
server {
    listen 80;
    server_name acta.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name acta.example.com;

    ssl_certificate /etc/letsencrypt/live/acta.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/acta.example.com/privkey.pem;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 💾 Backup & Disaster Recovery

Acta stores data in two persistent Docker volumes:
1. `postgres-data`: Database contents.
2. `attachment-data` and `avatar-data`: Uploaded files and user avatars.

### Automated Database Backup
Run the backup command:
```bash
docker compose exec postgres pg_dump -U acta_admin -d acta_production | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Restoring from Backup
```bash
gunzip < backup_file.sql.gz | docker compose exec -T postgres psql -U acta_admin -d acta_production
```
