# Acta i18n Error Messages Design

## Goal

Route every user-visible validation, service, server-action, and API error
through the central i18n catalog. English remains the default locale, Turkish
remains an optional partial locale, and future locales must not require page,
component, service, or route changes.

## Architecture

Business and domain services return stable error codes plus interpolation
values. They do not receive a locale or a translator. The application boundary
(Server Action, Route Handler, or Server Component) resolves the code through
the current translator. A small shared helper provides the same behavior for
Zod issues, whose schemas remain shared between client and server.

Every user-visible message has an English catalog key. Secondary dictionaries
may omit keys and safely fall back to English. Raw infrastructure errors remain
diagnostic data and are never used as user-facing copy without a localized
wrapper.

## Data flow

```text
schema/service -> stable error code + values
             -> action/route resolves current locale
             -> t(error key, values)
             -> localized UI or API response
```

The service layer may retain an English `message` field for existing non-HTTP
callers and diagnostics, but user-facing boundaries must prefer the descriptor.

## Testing

- Catalog tests verify every literal `t(...)` key exists in English.
- Translator tests verify locale fallback and interpolation.
- Validation tests verify representative Zod issues in English and Turkish.
- Service/action tests preserve existing error codes and English behavior.
- Full Vitest, typecheck, production build, and Chromium E2E suites must pass.
