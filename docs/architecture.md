# Acta Architecture & Design Principles

Acta is designed with enterprise-grade resilience, data integrity, and uncompromising authorization boundaries. This document outlines the core architectural patterns and design decisions.

---

## 🏗️ System Overview

Acta consists of three primary components:

```
                  ┌────────────────────────┐
                  │      Next.js 16        │
                  │   App Router (Web)     │
                  └───────────┬────────────┘
                              │
                              ▼
┌──────────────────┐    ┌────────────┐    ┌────────────────────┐
│ Background Daemon│───▶│ PostgreSQL │◀───│ Migration Runner   │
│ (Worker Service) │    │  Database  │    │ (One-shot Service) │
└──────────────────┘    └────────────┘    └────────────────────┘
```

1. **Next.js Web Application (`app`):** Handles user interfaces, server actions, authentication, and real-time SSE event subscriptions.
2. **PostgreSQL 17 Database (`postgres`):** Single source of truth. Contains database-level constraints, triggers, and partial indexes for unbreakable business invariants.
3. **Background Worker (`worker`):** An independent daemon process sharing the codebase that polls the transactional outbox queue, processes notification dispatches (email & web-push), checks shift windows, and calculates scheduled job pulses.
4. **Migration Runner (`migrate`):** A transient container that runs the migration compatibility wrapper before the application or worker boots. If a migration fails, the app does not start.

---

## 🛡️ Core Architectural Principles

### 1. Controlled Physical Deletions
Enterprise operational systems must remain verifiable for audits, so records are preserved by default.
* **No routine `DELETE` operations:** Users and organizational units are deactivated, while activities are cancelled during normal workflows. Their history remains available to authorized readers.
* **Explicit activity-deletion exception:** The root system administrator has a separate confirmation-code workflow for permanently deleting an activity when explicitly requested. It validates the closed-period and authorization rules, runs transactionally, and leaves an audit entry.
* **Status transitions:** Records transition through explicit lifecycle states (`ACTIVE`, `INACTIVE`, `CANCELLED`, `REJECTED`) whenever permanent deletion is not explicitly authorized.
* **Database triggers:** PostgreSQL triggers actively block direct deletes and allow the controlled activity-deletion path only through its transaction-scoped authorization marker.

### 2. Centralized Visibility & Authorization Layer
Acta strictly isolates departmental data:
* **Single Authorization Gate (`src/server/authz/visibility.ts`):** Every read path (activity lists, feeds, detail views, search queries, attachment downloads, and metrics) flows through this single module.
* **SQL Equivalence:** Complex scope calculations have direct SQL-level equivalents (`visibleActivitySql`) ensuring pagination and high-volume database queries perform identically to in-memory checks.
* **Immutable Hierarchy Boundary:** Users can only view activities written by themselves, their subordinates, peers (if unit sharing is enabled), or when explicitly tagged as a party/manager.

### 3. Transactional Outbox Pattern for Asynchronous Events
To avoid distributed transaction failures:
* **No Synchronous Side-Effects:** Notification emails and web-push dispatches are never sent synchronously inside a user request.
* **Outbox Table:** The user action and the corresponding notification event are committed in the **same database transaction**.
* **Worker Delivery:** The worker daemon processes outbox entries with exponential backoff (up to 5 retries), batching, and digest rollups.

### 4. Database-Level Constraint Invariants
Where application code could have race conditions, constraints are enforced in PostgreSQL:
* **One Root User Constraint:** Enforced via partial unique index `User_single_root_idx`.
* **Single Active Follow-Up:** An activity cannot have multiple open follow-up items simultaneously.
* **Immutable Audit Trail:** Append-only audit log where `UPDATE` or `DELETE` is prohibited at the database level.
* **Sequential Numbering:** Activity sequence numbers are issued by a dedicated PostgreSQL sequence (`activity_no_seq`) to guarantee conflict-free concurrent creation.

---

## 🗂️ Codebase Organization

* `src/app`: Next.js 16 App Router pages, layouts, error boundaries, and server actions.
* `src/components`: UI components built with Tailwind CSS v4, adhering to accessibility standards (WCAG AA).
* `src/server/auth`: Password hashing (Argon2id), session management, timing-safe authentications, and rate limiting.
* `src/server/authz`: Central visibility layer, manager resolution, organizational chain traversal, and repository abstraction.
* `src/server/activities`: Activity creation, updates, cancellations, and revision lifecycle rules.
* `src/server/scoring`: Scoring formulas, attendance calculations, appreciation kudos, and period freezing.
* `src/worker`: Background jobs: notification dispatcher, shift reminder worker, overdue approval monitor, and heartbeat reporter.
