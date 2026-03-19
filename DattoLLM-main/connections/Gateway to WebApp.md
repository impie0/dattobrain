---
type: Connection
from: "[[API Gateway]]"
to: "[[Web App]]"
---
# Gateway → Web App

**Route:** `/*` (catch-all, lowest priority)
**Port:** 3000
**Network:** Both on `public` Docker network

Serves Next.js pages and static assets. Only hit when no other upstream route matches. The `:80` label on the architecture diagram refers to APISIX's public-facing port.
