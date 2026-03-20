---
name: Qpm-discovery
description: "Runs product discovery: OST (Opportunity Solution Tree), assumption mapping, experiment design, interview scripts, feature request analysis. Use for 'discovery', 'opportunity tree', 'assumption test', 'experiment design', 'customer interview', '디스커버리', '가설 검증', '실험 설계', '고객 인터뷰'. Distinct from Qpm-strategy (strategic frameworks) — this validates customer problems and solutions."
---


## Purpose
Run continuous product discovery: map opportunities, surface risky assumptions, design cheap experiments, run customer interviews, and triage feature requests. Combines Teresa Torres' OST with Alberto Savoia's pretotyping into a single actionable workflow.

## 1. Opportunity Solution Tree (OST)

### Structure (4 Levels)
```
Desired Outcome (metric to move)
  -> Opportunity (unmet need / pain point)
       -> Solution (idea addressing the opportunity)
            -> Experiment (cheapest test of the riskiest assumption)
```

### Opportunity Score
```
Opportunity Score = Importance x (1 - Satisfaction)
```
- **Importance** (1-10): How critical is this need to the user?
- **Satisfaction** (0-1): How well do current solutions meet the need?
- High score = high importance + low satisfaction = best opportunity

### OST Template
```markdown
# OST: [Product / Feature Area]

## Desired Outcome
[Metric]: [Current] -> [Target] by [Date]

## Opportunities (ranked by Opportunity Score)
| # | Opportunity | Importance | Satisfaction | Score |
|---|-------------|-----------|-------------|-------|
| 1 | [unmet need] | 8 | 0.2 | 6.4 |
| 2 | [pain point] | 7 | 0.5 | 3.5 |

## Solutions per Opportunity
### Opportunity 1: [name]
- Solution A: [description]
- Solution B: [description]
- Solution C: [description]

## Experiments per Solution
### Solution A
- Assumption: [riskiest assumption]
- Experiment: [method] -> see Section 3
```

### Rules
- One tree per desired outcome
- Minimum 3 opportunities before jumping to solutions
- Minimum 3 solutions per opportunity before picking one
- Never skip from outcome to solution (always identify opportunity first)

## 2. Assumption Identification & Prioritization

### Risk Types (VUVF)
| Type | Question | Example |
|------|----------|---------|
| **Value** | Will users want this? | "Users care enough about X to switch" |
| **Usability** | Can users figure it out? | "Users can complete checkout in <3 steps" |
| **Viability** | Does it work for the business? | "CAC stays below $50 at scale" |
| **Feasibility** | Can we build it? | "API latency stays under 200ms" |

### Identification Process
1. List all assumptions behind each solution (brainstorm, don't filter)
2. Classify each by VUVF type
3. Mark leap-of-faith assumptions (if wrong, the entire solution fails)

### Prioritization Matrix
```
              High Impact
                  |
    TEST NOW      |    DECIDE LATER
   (high impact,  |   (high impact,
    high unknown)  |    low unknown)
                  |
  ----------------+----------------
                  |
    SKIP          |    MONITOR
   (low impact,   |   (low impact,
    high unknown)  |    low unknown)
                  |
              Low Impact

  High Uncertainty -----> Low Uncertainty
```

### Assumption Table Template
```markdown
| # | Assumption | Type | Impact | Uncertainty | Action |
|---|-----------|------|--------|-------------|--------|
| 1 | Users will pay $20/mo | Value | High | High | Test Now |
| 2 | Team can build in 2 sprints | Feasibility | Med | Low | Monitor |
```

## 3. Experiment Design

### XYZ Hypothesis Format
```
We believe that at least [X]% of [Y] will [Z].
```
- **X** = success threshold (measurable number)
- **Y** = target audience (specific segment)
- **Z** = observable behavior (action, not opinion)

Example: "We believe that at least 15% of trial users will click 'Upgrade' after seeing the usage limit banner."

### Pretotype Methods (Alberto Savoia)
| Method | Description | Best For | Time |
|--------|-------------|----------|------|
| **Landing Page** | Fake feature page with CTA | Value risk | 1-2 days |
| **Explainer Video** | Short video showing concept, measure sign-ups | Value risk | 2-3 days |
| **Email Campaign** | Describe feature to existing users, measure clicks | Value risk | 1 day |
| **Pre-order** | Accept orders before building | Value + Viability | 2-3 days |
| **Manual Service** | Deliver the service manually (Wizard of Oz) | Usability + Value | 3-5 days |
| **Concierge** | 1-on-1 manual delivery to learn | Usability | 1-2 days |
| **Single Feature** | Build only the core interaction | Feasibility + Value | 1-2 weeks |

### Skin-in-the-Game Principle
Measure **behavior**, not opinions. Valid signals require the participant to invest something:
- Time (signing up, completing a flow)
- Money (pre-order, deposit)
- Reputation (sharing publicly, referring others)

Opinions ("Would you use this?") are not experiments. Actions are.

### Experiment Card Template
```markdown
## Experiment: [Name]

**Assumption:** [What we're testing]
**Risk Type:** [Value / Usability / Viability / Feasibility]
**Hypothesis:** At least [X]% of [Y] will [Z].

**Method:** [Pretotype method]
**Duration:** [days]
**Success Criteria:** [X]% threshold met
**Failure Criteria:** Below [X]% -> pivot or kill

**Skin-in-the-Game:** [What participants invest]
**Data Collected:** [Metrics tracked]

**Result:** [Pass / Fail / Inconclusive]
**Learning:** [What we learned]
**Next Step:** [Persevere / Pivot / Kill]
```

## 4. Interview Script Generation

### Interview Structure
```markdown
## Interview Guide: [Topic]

### Setup (2 min)
- Thank participant, explain purpose
- "No right or wrong answers — we're learning from your experience"
- Ask permission to record

### Warm-up (3 min)
- Role / context questions
- "Tell me about your role and what a typical day looks like"

### Core Questions (20-30 min)
1. "Tell me about the last time you [relevant activity]..."
2. "Walk me through how you [process related to opportunity]..."
3. "What was the hardest part about that?"
4. "What happened next?"
5. "How do you handle [pain point] today?"
6. "What have you tried before to solve this?"

### Specific Probes (10 min)
- "You mentioned [X] — can you tell me more about that?"
- "Why was that important to you?"
- "How often does that happen?"

### Wrap-up (5 min)
- "Is there anything else about [topic] I should have asked?"
- "Who else should I talk to about this?"
- Thank and explain next steps
```

### Interview Rules
- Ask about **past behavior**, not future intent ("Tell me about the last time..." not "Would you...")
- Never pitch or describe your solution during the interview
- Follow the energy — probe where emotion or frustration appears
- One topic per interview (don't combine discovery + usability)
- 5 interviews reveal ~80% of themes (Nielsen)

### Synthesis Template
```markdown
## Interview Synthesis: [Topic] ([N] interviews)

### Key Themes
| Theme | Frequency | Representative Quote |
|-------|-----------|---------------------|
| [theme] | [N/total] | "[direct quote]" |

### Surprises
- [Things that contradicted our assumptions]

### Opportunity Candidates
- [Map themes back to OST opportunities]

### Open Questions
- [What we still don't know]
```

## 5. Feature Request Analysis

### Triage Workflow
```
Incoming Request
  -> Extract the PROBLEM (why they want it)
  -> Map to existing Opportunity (or create new)
  -> Assess frequency + severity
  -> Prioritize within OST
```

### Analysis Template
```markdown
## Feature Request: [Title]

**Source:** [Customer / Sales / Internal / Support]
**Verbatim:** "[Exact request as stated]"

### Problem Extraction
- **Stated solution:** [What they asked for]
- **Underlying problem:** [Why they asked — the real pain]
- **Who has this problem:** [Persona / segment]
- **How they solve it today:** [Workaround]

### Opportunity Mapping
- **Maps to Opportunity:** [Existing OST opportunity, or "NEW"]
- **Opportunity Score:** [Importance x (1 - Satisfaction)]

### Assessment
| Dimension | Rating | Notes |
|-----------|--------|-------|
| Frequency | [Daily/Weekly/Monthly/Rare] | |
| Severity | [Blocker/Major/Minor/Nice-to-have] | |
| Revenue impact | [High/Med/Low] | |
| Strategic fit | [Core/Adjacent/Distraction] | |

### Decision
- [ ] Add to OST and prioritize
- [ ] Merge with existing opportunity
- [ ] Defer (reason: )
- [ ] Decline (reason: )
```

### Feature Request Rules
- Never accept a request as-is — always extract the problem first
- "Build X" is a solution; "I can't do Y" is a problem
- Frequency + Severity > individual importance
- Requests from paying customers are signal, not mandate
- Batch and review weekly, don't react individually

## Workflow (End-to-End Discovery Cycle)

### Phase 1: Frame
- Define desired outcome (metric)
- Build initial OST from existing research

### Phase 2: Discover
- Run customer interviews (5-8 per round)
- Synthesize themes, update OST opportunities

### Phase 3: Prioritize
- Score opportunities (Importance x (1 - Satisfaction))
- Generate 3+ solutions per top opportunity
- Identify assumptions per solution (VUVF)
- Prioritize assumptions (Impact x Uncertainty)

### Phase 4: Experiment
- Design experiment for #1 riskiest assumption
- Write XYZ hypothesis
- Choose pretotype method
- Run experiment (1-2 weeks max)

### Phase 5: Decide
- Pass -> continue building confidence, test next assumption
- Fail -> pivot solution or re-examine opportunity
- Inconclusive -> redesign experiment with stronger signal

### Phase 6: Integrate
- Triage incoming feature requests against OST
- Update tree weekly with new learnings

## Anti-Patterns
- Solution-first thinking -> always start with opportunity identification
- "Let's just ask users what they want" -> observe behavior, not opinions
- Running experiments longer than 2 weeks -> if signal is that weak, rethink the experiment
- Skipping assumption identification -> you'll build on untested beliefs
- Treating OST as a one-time exercise -> update continuously with new data
- Ignoring failed experiments -> failures are the most valuable learning
- Accepting feature requests at face value -> always extract the underlying problem

Credits: Frameworks adapted from phuryn/pm-skills (MIT) -- OST based on Teresa Torres, experiments based on Alberto Savoia
