---
name: Qpm-gtm
description: "Plans go-to-market strategy: ICP definition, growth loops, battlecards, positioning/messaging, North Star metrics. Use for 'GTM', 'go-to-market', 'ICP', 'battlecard', 'growth loop', 'positioning', 'launch strategy', '시장 진출', '배틀카드', '포지셔닝'. Distinct from Qpm-strategy (analysis) — this plans market entry and competitive positioning."
---


## Purpose
Plan and execute go-to-market strategy from beachhead selection through growth loop design. Combines ICP definition, competitive battlecards, positioning/messaging, and North Star metrics into one integrated workflow.

## 1. Beachhead Segment & ICP

### Beachhead Selection
Pick one segment to dominate first. Evaluate candidates on:

| Criteria | Question |
|----------|----------|
| Urgency | Do they have a burning problem right now? |
| Accessibility | Can you reach them with current resources? |
| WTP | Will they pay enough to sustain the business? |
| Whole Product | Can you deliver a complete solution today? |
| Competition | Is the segment underserved? |
| Reference | Will early wins create word-of-mouth? |

Score each 1-5. Highest total = beachhead candidate.

### ICP Card Template
```markdown
# ICP: [Segment Name]

## Demographics
- Industry: [vertical]
- Company size: [employees / ARR range]
- Role/Title: [decision maker + champion]
- Geography: [region]

## Psychographics
- Core belief: [what they value]
- Biggest fear: [what keeps them up at night]
- Desired identity: [who they want to be seen as]

## Behavioral Traits
- Current solution: [what they use today]
- Trigger event: [what makes them search for alternatives]
- Buying process: [self-serve / committee / executive sponsor]
- Watering holes: [where they hang out — communities, events, publications]

## Qualification Criteria
- Must-have: [non-negotiable fit signals]
- Nice-to-have: [bonus signals]
- Disqualifiers: [red flags]
```

## 2. Growth Loop Design

A growth loop is a closed system where each cohort of users generates the input for the next.

### Loop Types

| Loop | Trigger | Mechanic | Output |
|------|---------|----------|--------|
| **Viral** | User action | Invite/share | New sign-ups |
| **Content** | SEO/UGC | Publish/rank | Organic traffic |
| **Paid** | Revenue | Reinvest in ads | New customers |
| **Sales** | Qualified lead | Demo/close | Revenue + referrals |

### Loop Diagram Structure
```
[New User] → [Activation] → [Core Value] → [Loop Mechanic] → [New User]
                                                ↑
                                          [Amplifier]
```

### Metrics Per Stage

| Stage | Metric | Example |
|-------|--------|---------|
| Input | New users/leads per period | 1,000 sign-ups/week |
| Activation | % reaching core value | 40% complete onboarding |
| Engagement | Frequency of loop action | 3 shares/user/month |
| Output | New users generated per cohort | 0.3 viral coefficient |
| Efficiency | CAC payback / loop cycle time | 4-month payback |

### Loop Design Checklist
- [ ] Identify which loop type fits your ICP
- [ ] Map every step from input to output
- [ ] Identify the amplifier (what makes the loop accelerate)
- [ ] Define metric for each stage
- [ ] Identify the bottleneck (lowest conversion step)

## 3. Battlecard Template

```markdown
# Battlecard: [Your Product] vs [Competitor]

## Overview
- What they do: [one sentence]
- Target market: [who they sell to]
- Pricing model: [how they charge]

## Strengths (Theirs)
- [strength 1]
- [strength 2]

## Weaknesses (Theirs)
- [weakness 1]
- [weakness 2]

## Win Themes (When We Win)
- [scenario/reason we win]

## Loss Themes (When We Lose)
- [scenario/reason we lose]

## Objection Handling
| Objection | Response |
|-----------|----------|
| "[competitor] has more features" | [response] |
| "[competitor] is cheaper" | [response] |
| "We already use [competitor]" | [response] |

## Killer Questions (Ask the Prospect)
- [question that exposes competitor weakness]
- [question that highlights your differentiator]

## Pricing Comparison
| | Us | Them |
|---|---|---|
| Entry price | $ | $ |
| Mid-tier | $ | $ |
| Enterprise | $ | $ |
| Hidden costs | [none / list] | [list] |
```

## 4. GTM Motion & Positioning/Messaging

### GTM Motion Types

| Motion | Best For | Key Metric | Org Shape |
|--------|----------|------------|-----------|
| **Product-led (PLG)** | Low ACV, high volume, try-before-buy | PQL conversion rate | Product + Growth |
| **Sales-led** | High ACV, complex sale, enterprise | SQL-to-close rate | Sales + SE |
| **Community-led** | Developer tools, open source, niche | Community-to-pipeline | DevRel + Community |

Pick one primary motion. Layer a second only after the first works.

### Positioning Framework
```markdown
## Positioning Statement
For [target customer]
who [situation/need],
[product] is a [category]
that [key differentiator].
Unlike [alternative],
we [proof point].

## Category
- Existing category: [name] — position as better/different
- New category: [name you are creating] — define the rules

## Differentiators (pick 1-2)
- [differentiator]: [proof point]
- [differentiator]: [proof point]
```

### Messaging Hierarchy

| Level | What | Example |
|-------|------|---------|
| **Tagline** | 5-8 words, memorable | "Ship faster without breaking things" |
| **Value Prop 1** | Benefit + mechanism | "Reduce deploy time 10x with zero-config CI" |
| **Value Prop 2** | Benefit + mechanism | "Catch regressions before merge with AI review" |
| **Value Prop 3** | Benefit + mechanism | "One dashboard for the entire release pipeline" |
| **Proof Points** | Evidence per value prop | Metrics, case studies, logos |

**Validation:** Test messaging with 5 ICP-fit prospects. If fewer than 3 say "tell me more," rewrite.

## 5. North Star Metric & Marketing Ideas

### Defining North Star Metric

The North Star metric captures the core value your product delivers. It must be:
- **Leading** (predicts future revenue, not trailing)
- **Actionable** (teams can influence it)
- **Customer-value-aligned** (reflects real usage, not vanity)

```markdown
## North Star Metric
- Metric: [name]
- Definition: [exact calculation]
- Current: [value]
- Target: [value] by [date]

## Input Metrics (levers that move North Star)
| Input | Owner | Current | Target |
|-------|-------|---------|--------|
| [metric] | [team] | [value] | [value] |
```

**Examples by business type:**

| Type | North Star | Why |
|------|-----------|-----|
| SaaS | Weekly active teams | Measures adoption + stickiness |
| Marketplace | Transactions per week | Both sides active |
| Media | Time spent reading/watching | Engagement = ad revenue |
| E-commerce | Purchases per month | Direct revenue proxy |

### Marketing Idea Generation

**Bullseye Framework** (Gabriel Weinberg):
1. Brainstorm: List 3 ideas per channel (19 channels)
2. Rank: Move top 3 to inner ring
3. Test: Run cheapest possible test per channel
4. Focus: Double down on the one that works

**19 Traction Channels:**
Viral marketing, PR, Unconventional PR, SEM, Social/Display ads, Offline ads, SEO, Content marketing, Email marketing, Engineering as marketing, Targeting blogs, Business development, Sales, Affiliate programs, Existing platforms, Trade shows, Offline events, Speaking engagements, Community building

**Idea Evaluation Card:**
```markdown
## Marketing Idea: [name]
- Channel: [which of 19]
- Hypothesis: [we believe X will drive Y]
- Test: [cheapest way to validate]
- Cost: [$X / time]
- Success metric: [what number proves it works]
- Timeline: [days to result]
```

## Anti-Patterns
- Skipping beachhead → trying to sell to everyone = selling to no one
- Multiple growth loops at once → master one before layering
- Battlecards without sales input → talk to reps who lost deals
- Positioning by features → position by outcome and proof
- Vanity North Star (sign-ups, page views) → pick a value metric
- Messaging without validation → test with real ICP prospects

Credits: Frameworks adapted from phuryn/pm-skills (MIT)
