# Qlaravel-specialist Review Evidence

- expert: Qlaravel-specialist
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: not available from Packagist summary used here
- currentMajor: 13
- verifiedMajor: 13
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: none

## sourceUrls

- https://laravel.com/docs/13.x/releases
- https://repo.packagist.org/p2/laravel/framework.json

## sourceCommands

- `curl -fsSL https://repo.packagist.org/p2/laravel/framework.json`

## raw command output / API summary

- Packagist API latest package summary -> `laravel/framework v13.19.0`
- Official Laravel docs expose the `13.x` release notes/docs branch.
- `composer` is not installed locally, so Composer CLI verification was not available.

## official-doc provenance

Laravel official docs branch supplied release-documentation provenance.

## registry provenance

Packagist API supplied package major/version evidence.

## changedSections

- Description/triggers now target Laravel 13.
- Added Current Version Notes.
- Clarified Laravel 12 and earlier as migration/maintenance contexts unless pinned.

## residualRisk

Composer CLI was unavailable in this environment. Verify with project `composer.json` and `composer show laravel/framework` inside real Laravel apps.
