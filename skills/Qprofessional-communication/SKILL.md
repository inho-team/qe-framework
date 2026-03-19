---
name: Qprofessional-communication
description: Technical communication guide for software developers. Covers email structure, team message etiquette, meeting agendas, and tailoring messages for technical and non-technical audiences. Use when writing professional messages, 이메일 작성, 업무 메시지, preparing for meeting communication, or improving written documentation skills.
allowed-tools: Read, Glob, Grep
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


# Professional Communication

## Overview

A framework and guide for effective professional communication in software development environments.

**Core principle:** Effective communication is not about proving how much you know — it's about ensuring your message lands and is understood.

## When to Use This Skill

- Writing emails to teammates, managers, or stakeholders
- Composing team chat messages or async communication
- Preparing meeting agendas or meeting notes
- Explaining technical concepts to non-technical audiences
- Structuring progress updates or reports

## Core Frameworks

### What-Why-How Structure

| Component | Purpose | Example |
|-----------|---------|---------|
| **What** | State the topic/request clearly | "We need to delay the release by one week" |
| **Why** | Explain the reason | "A critical bug was found in payment processing" |
| **How** | Next steps/action items | "QA will retest by Thursday; announcement on Friday" |

### Three Golden Rules of Written Communication

1. **Start with a clear subject/purpose** — the recipient can grasp it immediately
2. **Use bullet points, headings, scannable formatting** — avoid walls of text
3. **Lead with the key message** — busy people value efficiency

### Know Your Audience

1. **Who** are you writing to? (technical peer, manager, stakeholder, customer)
2. **What level of detail** do they need?
3. **What value** does this have for them?

## Email Best Practices

### Subject Line Formula

| Instead of | Use |
|------------|-----|
| "Project update" | "Project X: Progress and next steps" |
| "Question" | "Quick question: API rate limiting approach" |
| "FYI" | "FYI: Deployment scheduled Tuesday 3pm" |

### Email Structure Template

```markdown
**Subject:** [Project/Topic]: [Specific purpose]

Hi [Name],

[State the key point or request in 1-2 sentences up front]

**Background:**
- [Item 1]
- [Item 2]

**What I need:**
- [Specific action or decision requested]
- [Deadline if applicable]

Thanks,
[Name]
```

### Common Email Types

| Type | Key Elements |
|------|-------------|
| **Progress update** | Summary of progress, blockers, next steps, timeline |
| **Request** | Clear ask, background, deadline, why it matters |
| **Escalation** | Problem summary, impact, solutions tried, decision needed |
| **Announcement/FYI** | What changed, who is affected, action required |

## Team Message Etiquette

### When to Use Chat vs. Email

| Use Chat | Use Email |
|----------|-----------|
| Quick questions needing short answers | Detailed docs that need a paper trail |
| Real-time coordination | Formal communication |
| Informal team discussion | Messages requiring careful review |
| Urgent updates | Complex explanations |

### Team Message Best Practices

1. **Use threads** — keep the main channel easy to scan
2. **Mention sparingly** — avoid unnecessary notifications
3. **Organize by channel** — right topic in the right channel
4. **Be direct** — "Can you review this PR?" beats "Are you busy?"
5. **Be async-friendly** — write messages that don't require an immediate response

### The "No Hello" Principle

Instead of sending "Hey Sarah" and waiting, send:
```
Hi Sarah — I have a question about the deploy script.
Getting a permission error on line 42 — have you seen this before?
Error: [paste error]
```

## Technical vs. Non-Technical Communication

| Audience | Approach |
|----------|----------|
| **Developer peers** | Technical details, code examples, architecture specifics |
| **Technical managers** | Balance detail with high-level impact |
| **Non-technical stakeholders** | Business impact, analogies, outcomes over implementation |
| **Customers** | Plain language, what it means for them, avoid jargon |

### Jargon Translation Examples

| Technical Term | Plain Language |
|---------------|----------------|
| "Microservices architecture" | "The system is split into small pieces that can scale independently" |
| "Asynchronous message processing" | "Tasks queue up and are processed in the background" |
| "CI/CD pipeline" | "An automated process that tests and deploys code" |
| "Database migration" | "Updating how data is structured and stored" |

## Clear Writing Principles

### Use Active Voice

| Passive (avoid) | Active (prefer) |
|-----------------|-----------------|
| "A bug was found by the team" | "The team found a bug" |
| "The feature will be implemented" | "We will implement the feature" |

### Cut Filler Phrases

| Instead of | Use |
|------------|-----|
| "At this point in time" | "Now" |
| "In the event that" | "If" |
| "For the purpose of" | "To" |
| "I was wondering if you could" | "Could you" |

### The "So What?" Test

After writing, ask: "So what? Why does this matter to the reader?" If you can't answer clearly, restructure the message.

## Meeting Communication

### Before: Agenda Best Practices

1. **Clear objective** — what will we accomplish?
2. **Agenda items** — topics to cover with time estimates
3. **Pre-work** — what attendees should bring or review
4. **Expected outcomes** — decisions? information sharing? brainstorming?

### After: Meeting Notes Format

```markdown
**Meeting: [Topic] - [Date]**

**Attendees:** [Names]

**Key Decisions:**
- [Decision 1]
- [Decision 2]

**Action Items:**
- [ ] [Owner]: [Task] - Due [date]
- [ ] [Owner]: [Task] - Due [date]

**Next Steps:**
- [Follow-up meeting if needed]
- [Documents to share]
```

## Communication Checklist

Before sending professional communication:

- [ ] **Clear purpose** — can the intent be grasped in 5 seconds?
- [ ] **Right audience** — right people/channel?
- [ ] **Key message first** — main point up front?
- [ ] **Scannable** — bullet points, headings, short paragraphs?
- [ ] **Clear action** — does the recipient know what to do?
- [ ] **Jargon check** — will the audience understand all terms?
- [ ] **Appropriate tone** — professional but not stiff?
- [ ] **Proofread** — no typos or unclear phrasing?
