---
name: Qsource-verifier
description: "Verifies source credibility and digital content authenticity using the SIFT method (Stop, Investigate, Find, Trace). Use when asked to 'verify this source', 'check credibility', 'is this reliable', or when investigating social media accounts, verifying images/videos/documents, or building verification trails. Produces structured verification records with confidence ratings."
metadata:
  source: https://github.com/jamditis/claude-skills-journalism
  author: jamditis
  version: "1.0.0"
  domain: writing
  triggers: verify source, check credibility, is this reliable, source check, verify image, verify document, SIFT, verification trail
  role: specialist
  scope: analysis
  output-format: report
  related-skills: Qfact-checker, Qcontent-research-writer
keywords: source verification, credibility, SIFT, digital verification, image verification, document verification
---

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Source Verifier — Source Verification Methodology

Systematically verifies the credibility of sources and the authenticity of digital content.

## SIFT Methodology

| Step | Action | Description |
|------|--------|-------------|
| **S** — Stop | Stop | Do not share or cite before verifying |
| **I** — Investigate | Investigate the source | Who is behind the information? |
| **F** — Find | Find other coverage | What do other credible sources say? |
| **T** — Trace | Trace claims | Find the original source of the claim |

## Source Credibility Assessment

### Assessment Template

```markdown
## Source Assessment: [Source Name]

### Basic Identification
- [ ] Real name/organization confirmed
- [ ] Contact information verifiable
- [ ] Professional credentials verifiable
- [ ] Online presence is consistent across platforms

### Expertise Assessment
- [ ] Has relevant expertise for the claim
- [ ] Has track record in the field
- [ ] Recognized by peers
- [ ] No history of spreading misinformation

### Motivation Analysis
- [ ] Potential conflicts of interest identified
- [ ] Financial interest in the outcome?
- [ ] Political/ideological motivation?
- [ ] Related to personal grievances?

### Cross-Verification
- [ ] Claim independently verifiable?
- [ ] Confirmed by other credible sources?
- [ ] Documentary evidence exists?
- [ ] Contradicting sources exist?
```

### Credibility Ratings

| Rating | Criteria |
|--------|---------|
| **High** | Real name, relevant expertise, documentary evidence, no conflict of interest |
| **Medium** | Real name but expertise partially unclear, or indirect interest |
| **Low** | Anonymous, unverified expertise, potential conflict of interest |
| **Suspicious** | History of misinformation, clear conflict of interest, unverifiable |

## Digital Content Verification

### Image Verification

```markdown
## Image Verification Process

### Step 1: Reverse Image Search
- Google Images (images.google.com)
- TinEye (tineye.com)
- Yandex Images (yandex.com/images) — best for facial recognition
- Bing Visual Search

### Step 2: Metadata (EXIF) Check
- Original capture date/time
- Camera/device information
- GPS coordinates (if present)
- Software used for editing

### Step 3: Image Content Analysis
- Weather conditions (match reported date?)
- Shadows (match time of day?)
- Signs/text (correct language for the location?)
- Architecture (match claimed location?)

### Step 4: Find Original Source
- When did it first appear online?
- Original photographer/source
- Original posting context
- Has it been used in other contexts?
```

### Social Media Account Analysis

```markdown
## Account Verification Checklist

### Account History
- Creation date (older = more credible)
- Posting frequency and patterns
- Activity gaps (dormant then suddenly active?)

### Network
- Follower/following ratio
- Follower quality (real accounts vs. bots)
- Connections with verified accounts

### Red Flags
- Recently created account making bold claims
- Sudden changes in topic/tone
- Coordinated behavior with other accounts
- Stock photo profile picture
```

### Document Verification

```markdown
## Document Verification Steps

### Metadata Inspection
- Creation date and edit history
- Author information
- Software used
- Embedded fonts/images

### Visual Inspection
- Consistent formatting throughout
- Font consistency (no synthesized text)
- Text/image alignment
- Quality consistency across pages

### Content Verification
- Dates internally consistent
- Names spelled consistently throughout
- Reference numbers valid
- Contact information verifiable
- Letterhead matches known examples

### Source Tracing
- How was the document obtained?
- Chain of custody documented?
- Original vs. copy
```

## Verification Record Template

```markdown
## Verification Record

**Subject:** [claim/content description]
**Source:** [name/account/platform/URL]
**Verification Date:** [date]

### Verification Steps

#### Step 1: [Description]
- Actions taken:
- Tools/methods used:
- Result:

#### Step 2: [Description]
...

### Cross-Checked Sources
1. [Source 1] — [what it confirmed]
2. [Source 2] — [what it confirmed]

### Contradicting Information
1. [Source] — [contradiction]

### Verdict
- [ ] Verified (true)
- [ ] High confidence (likely true)
- [ ] Unverified (insufficient evidence)
- [ ] Low confidence (contradicting evidence exists)
- [ ] Confirmed false

### Basis for Verdict
[Evidence-based conclusion]
```

## Evidence Preservation

### Web Archiving

- **Wayback Machine** (web.archive.org/save/) — general web archive
- **Archive.today** (archive.ph) — snapshot preservation
- **Perma.cc** — permanent preservation for academic/legal use

### Screenshot Principles

1. Full-page capture
2. Include URL bar (show source URL)
3. Include timestamp
4. Save both PNG (lossless) and PDF
5. Record time and method of capture

## Execution Rules

### MUST DO
- Follow SIFT order (Stop → Investigate → Find coverage → Trace origin)
- Use WebSearch to investigate source background and credibility
- Actively search for contradicting evidence
- Document the verification process

### MUST NOT DO
- Do not declare "verified" from a single source
- Do not accept expertise based on self-claim alone
- Do not judge credibility intuitively without verification process
- Do not assess credibility solely by social media follower count
