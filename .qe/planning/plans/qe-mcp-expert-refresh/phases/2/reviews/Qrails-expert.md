# Qrails-expert Review Evidence

- expert: Qrails-expert
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: 2026-03-24 for checked Rails maintenance post
- currentMajor: 8
- verifiedMajor: 8
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: local `gem search` did not return a useful package result; official Rails guides and release pages were used for verified major.

## sourceUrls

- https://guides.rubyonrails.org/8_1_release_notes.html
- https://guides.rubyonrails.org/
- https://rubyonrails.org/2026/3/24/Rails-Versions-8-0-5-and-8-1-3-have-been-released

## sourceCommands

- `gem search '^rails$' --remote --exact`

## raw command output / API summary

- `ruby -e 'puts RUBY_VERSION'` -> `2.6.10`
- `gem search '^rails$' --remote --exact` -> no useful result in this environment.
- Official Rails Guides page is for Rails 8.1 and identifies v8.1.3 guide set.

## official-doc provenance

Rails Guides and rubyonrails.org release/maintenance post supplied version and support guidance.

## registry provenance

RubyGems command was attempted but did not produce a reliable package result locally.

## changedSections

- Description/triggers now target Rails 8.1.
- Added Current Version Notes.
- Clarified Rails 7 guidance as legacy/migration-only.

## residualRisk

Because local RubyGems lookup was not useful, recheck RubyGems or Bundler in a modern Ruby environment before release-critical migration work.
