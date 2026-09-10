# Acta

> **Open-Source Daily Activity Reporting, Hierarchical Approvals & Async Accountability Platform**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-316192.svg)](https://www.postgresql.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](tsconfig.json)

**[Türkçe Dokümantasyon için tıklayın](README.tr.md)**

---

## 💡 Why Acta?

Modern organizations often get caught between two extremes:

1. **Overly Complex Issue Trackers** (Jira, Linear): Built for engineering sprints, not for department-wide daily recaps, hierarchical rollups, or quick managerial check-ins.
2. **Unstructured Chat Standups** (Slack, Teams bots): Creates endless noisy notifications, lacks verification, provides no audit history, and loses accountability over time.

**Acta bridges this gap.** It is a self-hosted, structured operational platform designed for companies that need transparency, organizational hierarchy, and asynchronous discipline without micromanagement.

---

## ✨ Key Capabilities

### 1. ⚡ Swift Daily Activity Logging
* **Sub-30 second logging**: Distraction-free interface designed for fast daily entries.
* **Client-side draft recovery**: Auto-saves unsubmitted input locally so work is never lost.
* **Rich file attachments**: Validated via cryptographic mime-signatures with secure visibility checks.

### 2. 🌳 Organizational Tree & Visibility Matrix
* **Dynamic corporate hierarchy**: Multi-tier organizational units with manager inheritance.
* **Configurable visibility paths**: Decide whether activities flow upward to executive levels or remain strictly bounded within departments.
* **Read receipts**: Built-in 2-second attentive viewing measurement for management visibility.

### 3. ✅ Hierarchical Approvals & Reviews
* **Direct manager review**: Activities from designated units require manager sign-off before entering executive streams.
* **Reasoned revisions & rejections**: Managers can request specific revisions or reject entries with standardized category codes.
* **Batch operations**: Fast multi-entry approval queues for high-volume managers.

### 4. 💬 Contextual Q&A & Follow-ups
* **Threaded activity conversations**: Ask questions directly on entries; responsibility dynamically toggles between author and reviewer.
* **Independent follow-up tracking**: Action items tied to activities with mandatory closing notes and reason-backed reopening.

### 5. 🛡️ Enterprise-Grade Compliance & Audit
* **Zero physical deletion policy**: Records, users, and units are soft-deactivated or cancelled; foreign keys prevent accidental data loss.
* **Immutable audit trails**: Comprehensive append-only operational log recording every security, organizational, and authorization event.
* **Strict authorization boundaries**: Single central authorization gateway ensuring zero data leak between unrelated units.

### 6. ⏰ Working Calendars & Reminders
* **Unit-specific working calendars**: Flexible business days, shift windows, and public holidays.
* **Autonomous background worker**: Delivers evening reminders, overdue response nudges, and digest notifications via the Transactional Outbox pattern.

### 7. 📊 Performance & Transparency
* **Customizable scoring engine**: Transparent daily participation scoring with holiday and absence adjustments.
* **Peer appreciations**: Managers can award kudos without distorting mathematical compliance scores.
* **Organizational metrics**: Activity trend graphs, status breakdowns, and team participation heatmaps.

---

## 🛠️ Tech Stack

* **Framework:** Next.js 16 (App Router, Server Actions, React 19)
* **Language:** TypeScript (`strict` mode)
* **Database & ORM:** PostgreSQL 17 + Prisma 6
* **Worker & Jobs:** Dedicated Node.js background process (Outbox & Scheduler)
* **Styling:** Tailwind CSS v4
* **Validation:** Zod (shared client/server schemas)
* **Testing:** Vitest (1,500+ unit & DB integration tests) + Playwright (end-to-end browser tests)
* **Deployment:** Docker & Docker Compose

---

## 🚀 Quick Start in 60 Seconds

### Prerequisites
* [Docker](https://docs.docker.com/get-docker/) & Docker Compose
* (Optional for local development) Node.js >= 22 and [pnpm](https://pnpm.io/) >= 9

### 1. Clone and Configure
```bash
git clone https://github.com/ismailcehreli/acta.git
cd acta
cp .env.example .env
```
> **Note:** Generate a strong random key for `APP_SECRET` and set secure PostgreSQL credentials in `.env`.

### 2. Launch with Docker Compose
```bash
docker compose up --build -d
```
Docker will automatically initialize the database schema via the migration service, launch PostgreSQL, and start both the web application and the background worker daemon.

### 3. Initialize Root Administrator
In another terminal, initialize the root unit and the first system administrator:
```bash
docker compose exec app pnpm kurulum
```
*(Or if running locally: `pnpm kurulum`)*. The command will output a temporary password for the administrator.

### 4. (Optional) Load Rich Demo Data
To evaluate Acta with realistic departments, users, activities, and approval flows:
```bash
docker compose exec app pnpm seed:demo
```
*(This creates an interactive sandbox with sample teams and 12 days of activities. Demo data can be safely removed anytime from the administration panel).*

Visit **`http://localhost:3000`** in your browser and log in!

---

## 📂 Project Structure

```
acta/
├── prisma/               # Prisma schema & PostgreSQL SQL migrations
├── public/               # Static assets & web-push service worker
├── src/
│   ├── app/              # Next.js App Router (pages & server actions)
│   ├── components/       # Reusable UI components & application shell
│   ├── server/           # Business logic, auth, repositories & scoring
│   ├── shared/           # Zod schemas, utilities & common types
│   └── worker/           # Background scheduler & notification dispatcher
├── tests/                # Vitest unit & integration test suites
├── e2e/                  # Playwright end-to-end browser specifications
└── docker-compose.yml    # Multi-container production stack
```

---

## 🧪 Testing & Code Quality

Acta is heavily tested with zero tolerance for authorization leaks or data corruption:

```bash
# Run unit and integration tests (1,500+ tests)
pnpm test

# Type check
pnpm typecheck

# Lint codebase
pnpm lint

# Run Playwright end-to-end suite (Chromium)
pnpm e2e
```

---

## 📖 Documentation

* [Architecture Overview](docs/architecture.md) — Core principles, visibility matrix, and data flow.
* [Deployment & Operations](docs/deployment.md) — Production setup, reverse proxy, backups, and SSL.
* [Contributing Guide](CONTRIBUTING.md) — How to propose changes and development conventions.
* [Türkçe Tanıtım ve Kurulum](README.tr.md) — Türkçe kullanım ve mimari özeti.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.
