# Open standards and interoperability: access-gate-gateway-client

The gateway wire protocol, client side.

This page lists what the project speaks today, what is planned, what was considered and does not apply, where someone else can extend it, and what proves each claim. The platform-wide list is [Standards we use](https://meddleware.dev/platform/standards). A row appears there in the same change that turns a standard on.

## Spoken today

- EdDSA signatures over a documented, versioned message (RFC 8032)
- The conformance vectors the gateway also checks

## Planned

- RFC 9457 problem details for gateway errors

## Considered, not applicable

- none

## Extension points

- The protocol is specified in the access-gate-gateway repository; any compatible client can speak it

## What proves it

- its unit tests and the shared conformance vectors

_Maintained centrally with the platform's interoperability map; changes go through it so every repository says the same thing._
