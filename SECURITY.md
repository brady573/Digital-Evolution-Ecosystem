# Security Policy

## Supported versions

The `main` branch is the only supported line. Prototype sources under `legacy/prototype/` are frozen evidence, not supported code.

## Reporting a vulnerability

Open a GitHub issue with the `security` label, or contact the repository owner directly. Include:

- A description of the issue and its potential impact
- Steps to reproduce
- The engine/app version, if product-related

Do not open public issues with exploit details before a fix is available — report privately first.

## Scope notes

This product is offline-first by design: the simulation, saves, history, and inspection must work with no network. Factors that would break that guarantee (unexpected network calls, external services, analytics) are treated as security-relevant.
