# Qvite Review Evidence

- expert: Qvite
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: 2026-06-23 for Vite 8.1 announcement
- currentMajor: 8
- verifiedMajor: 8
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: none

## sourceUrls

- https://vite.dev/blog/announcing-vite8-1
- https://vite.dev/blog/announcing-vite8
- https://vite.dev/releases

## sourceCommands

- `npm view vite version`

## raw command output / API summary

- `npm view vite version` -> `8.1.4`
- Official Vite releases page reports `vite@8.1` as the regular patch line, with selected backports for older supported lines.

## official-doc provenance

Vite official blog and releases page supplied version and support guidance.

## registry provenance

npm package metadata confirmed the current Vite major/minor.

## changedSections

- Description now targets Vite 8.1.
- Replaced beta wording with reviewed Vite 8.1 wording.
- Added Current Version Notes and large-app bundled dev mode caveat.

## residualRisk

Rolldown and bundled dev mode behavior can vary by plugin ecosystem. Keep rollback notes for large migrations.
