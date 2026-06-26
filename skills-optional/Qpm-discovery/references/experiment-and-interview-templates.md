# Experiment Design & Interview Templates

## Experiment Design

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

---

## Interview Script Generation

### Interview Structure
```markdown
## Interview Guide: [Topic]

### Setup (2 min)
- Thank participant, explain purpose
- "No right or wrong answers -- we're learning from your experience"
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
- "You mentioned [X] -- can you tell me more about that?"
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
- Follow the energy -- probe where emotion or frustration appears
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
