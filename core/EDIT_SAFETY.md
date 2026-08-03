# Edit Safety

QE supports an optional line-content precondition for the host `Edit` tool. It
adds stale-content protection without replacing the host patch engine or
changing existing unanchored Edit requests.

## Anchor contract

An anchored request includes a 1-based line number and the 16-character SHA-256
prefix of that line's exact UTF-8 content, excluding the line terminator:

```json
{
  "file_path": "src/example.mjs",
  "old_string": "before",
  "new_string": "after",
  "line_anchor": { "line": 12, "hash": "0123456789abcdef" }
}
```

Use `createLineAnchor(content, line)` from
`scripts/lib/stale-edit-guard.mjs` to produce the anchor. Before the Edit reaches
the host, PreToolUse reads the latest file and permits the request only when the
line hash still matches. The adapter removes `line_anchor` from the forwarded
host input after a successful check.

## Conflict and remap policy

A malformed anchor, unreadable target, missing line, or hash mismatch blocks the
edit. The guard never forces the conflicting edit.

On mismatch it scans current lines for the observed hash. A single match returns
that new line and hash as `unique-hash-match`. If the original line changed in
place, the response instead provides the current line's new hash. Ambiguous
matches do not guess. The caller must re-read, create a fresh anchor, and retry.

Requests without `line_anchor` retain the existing Edit behavior for backward
compatibility. Hash anchoring is an additional precondition, not a replacement
for `old_string` matching.

Clients that observe several lines may instead attach
`stale_edit_precondition: { observations: [{ line, hash }] }`. The same policy
checks every observation and strips the envelope before forwarding the normal
Edit, MultiEdit, or patch input.
