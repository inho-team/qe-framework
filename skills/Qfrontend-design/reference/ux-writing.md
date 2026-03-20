# UX Writing

## Buttons & Labels

Be specific. Replace generic terms with action-oriented language:

| Instead of | Use |
|-----------|-----|
| OK | Save changes |
| Submit | Create account |
| Cancel | Discard draft |
| Delete selected | Delete 5 items |
| Click here | View pricing plans |

For destructive actions, show exactly what will happen.

## Error Messages

Answer three questions: what happened, why it matters, how to fix it.

| Instead of | Use |
|-----------|-----|
| Invalid input | Email needs an @ symbol |
| Error 403 | You don't have access. Ask the project owner to invite you. |
| Something went wrong | Payment failed. Check your card number and try again. |

Never blame the user. Reframe errors as system feedback.

## Tone by Context

Brand voice stays consistent, tone shifts by situation:

| Context | Tone |
|---------|------|
| Success | Brief celebration: "Done! Your changes are live." |
| Error | Empathy + solution: "We couldn't save. Check your connection." |
| Empty state | Invitation: "No projects yet. Create your first one." |
| Loading | Reassurance: "Setting things up..." |

Never use humor in error states. Frustrated users need practical help.

## Accessibility

- Link text must work independently ("View pricing plans" not "Click here")
- Don't rely on color alone to convey meaning — add text/icons
- Use `aria-live` regions for dynamic status updates

## Internationalization

- German needs ~30% more space than English
- Keep numbers separate from strings for translation
- Use full sentences — fragments are hard to translate
- Avoid idioms and cultural references

## Consistency

Pick one term per concept and stick with it:
- "Delete" or "Remove" — not both
- "Settings" or "Preferences" — not both
- Document choices in a terminology glossary
