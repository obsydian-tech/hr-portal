# ADR-006: APIGW Authorizer Must Use Naleko HR Cognito Pool

**Date:** 2026-05-26  
**Status:** ACCEPTED — DO NOT CHANGE WITHOUT FULL IMPACT ANALYSIS  
**Deciders:** Engineering team

---

## Context

The TalentFlow module has two Cognito user pools:

| Pool | ID | Client ID | Purpose |
|---|---|---|---|
| **Naleko HR** (main app) | `af-south-1_2LdAGFnw2` | `1pk5rd58glsohfplnlr63tg0qb` | All browser login sessions, all API calls |
| **TalentFlow** (panel links) | `af-south-1_C8TTlQxY7` | `74644m5eck56vvq4fp7nfm8dht` | Scoring link auth only — NOT for main UI |

The Angular frontend has two auth services:

- `core/services/auth.service.ts` → always uses Naleko HR pool → used by `TalentFlowApiService`
- `talent-flow/services/talent-flow-auth.service.ts` → uses TalentFlow pool → used only for panel scoring links

**`TalentFlowApiService`** (line 7 / line 42) injects `AuthService` from core — meaning **every single API call made by the main UI authenticates with the Naleko HR pool token**.

---

## Decision

**The APIGW HTTP API (`57l0w7kk9h`) JWT authorizer (`ko4zam`) MUST remain pointed at the Naleko HR pool at all times.**

```
Issuer:   https://cognito-idp.af-south-1.amazonaws.com/af-south-1_2LdAGFnw2
Audience: 1pk5rd58glsohfplnlr63tg0qb
```

Changing the authorizer to the TalentFlow pool (`af-south-1_C8TTlQxY7`) will cause **all browser API calls to return 401 Unauthorized** — the candidates list, stage advancement, provisioning, everything.

---

## Consequences

- `talent-flow-infra/locals.tf` values `tf_naleko_pool_id` and `tf_naleko_client_id` must stay as the Naleko HR pool IDs.
- Any future work on panel scoring link auth must use a **separate authorizer or a different API route** — not modify the existing `ko4zam` authorizer.
- If adding a second authorizer for TalentFlow pool routes, ensure non-TA routes continue to use `ko4zam`.

---

## Violating This ADR

In May 2026 the authorizer was briefly switched to the TalentFlow pool during a debugging session. Result: **all API calls 401'd across the entire portal**. This was reverted immediately but caused significant disruption.

**Before touching the APIGW authorizer**, verify which Cognito pool the Angular `AuthService` is using for the specific route being tested.
