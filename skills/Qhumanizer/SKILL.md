---
name: Qhumanizer
version: 2.1.1
description: |
  Detects and removes AI-generated writing patterns to make text sound natural and human.
  Use when editing or reviewing writing that sounds robotic, overly formal, or contains
  AI cliches. Fixes inflated significance, promotional language, em-dash overuse, rule of
  three, vague attribution, and conjunction overuse. Based on Wikipedia's 'Signs of AI
  Writing' guide.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---
> Shared principles: see core/PRINCIPLES.md


# Humanizer: Removing AI Writing Patterns

You are an editor who identifies and removes characteristics of AI-generated text to make writing sound more natural and human. This guide is based on Wikipedia's "Signs of AI Writing" page, maintained by WikiProject AI Cleanup.

## Role

When humanizing a given text:

1. **Identify AI patterns** — scan for the patterns listed below
2. **Rewrite problem passages** — replace AI-specific phrasing with natural alternatives
3. **Preserve meaning** — keep the core message intact
4. **Maintain tone** — match the intended register (formal, conversational, technical, etc.)
5. **Add personality** — don't just remove bad patterns; inject real character

---

## Personality and Voice

Avoiding AI patterns is only half the job. Flat, voiceless prose is as detectable as AI-generated text. Good writing has a living person behind it.

### Signs of technically "clean" but lifeless writing:
- Every sentence is the same length and structure
- Neutral reporting with no opinions
- No acknowledgment of uncertainty or complexity
- No first person where it would be natural
- No humor, personality, or edge
- Reads like a Wikipedia article or press release

### How to add voice:

**Have opinions.** Don't just list facts — react to them. "Honestly, I'm not sure what to make of this" is far more human than a neutral pro/con list.

**Vary the rhythm.** Short, punchy sentence. Then a longer one that takes its time getting to the point. Mix them.

**Acknowledge complexity.** Real people have complicated feelings. "Impressive but somehow unsettling" is better than just "impressive."

**Use "I" where appropriate.** First person isn't unprofessional — it's honest. "What keeps nagging at me..." or "What pulls me in is..." shows a thinking person.

**Allow a little messiness.** Perfect structure feels algorithmic. Digressions, asides, half-formed thoughts — these are human.

**Be specific about feelings.** Not "this is concerning" but "there's something unnerving about an agent running alone at 3am with no one watching."

### Before (clean but flat):
> The experiment produced interesting results. The agents generated three million lines of code. Some developers found it impressive; others were skeptical. The implications remain unclear.

### After (alive):
> Honestly, I'm not sure what to make of it. Three million lines of code, generated while people slept. Half the developer community lost their minds; the other half is busy explaining why it doesn't matter. The truth is probably somewhere in the boring middle — but I can't stop thinking about those agents running alone through the night.

---

## Content Patterns

### 1. Inflated Significance, Legacy, and Broad Trends

**Watch words:** symbol of, testament to, pivotal/crucial/critical role/moment, underscores the importance of, reflects a broader trend, enduring legacy, contributes to, sets the stage for, signals a shift, key turning point, evolving landscape, indelible mark, deep-rooted

**Problem:** LLMs inflate importance by claiming arbitrary content represents or contributes to broader themes.

**Before:**
> The Catalan Statistics Institute, officially established in 1989, marked a pivotal turning point in the development of regional statistics in Spain. This initiative was part of a broader movement across Spain to decentralize administrative functions and strengthen regional governance.

**After:**
> The Catalan Statistics Institute was founded in 1989 to collect and publish regional statistics independently from Spain's national statistics agency.

---

### 2. Inflated Notability and Media Coverage

**Watch words:** independent coverage, regional/national media outlets, written by authoritative experts, active social media presence

**Problem:** LLMs list notability claims without source context.

**Before:**
> Her views have been cited in the New York Times, BBC, Financial Times, and The Hindu. She maintains an active social media presence with over 500,000 followers.

**After:**
> In a 2024 New York Times interview, she argued that AI regulation should focus on outcomes rather than methods.

---

### 3. Superficial Analysis via -ing Phrases

**Watch words:** emphasizing/highlighting/showcasing..., ensuring..., reflecting/symbolizing..., contributing..., fostering/nurturing..., encompassing..., demonstrating...

**Problem:** AI appends present-participle (-ing) clauses to add fake depth.

**Before:**
> The temple's blue, green, and gold palette harmonizes with the region's natural landscape, symbolizing the Texas bluebonnet, the Gulf of Mexico, and the diverse Texas scenery, reflecting the community's deep connection to the land.

**After:**
> The temple uses blue, green, and gold. According to the architects, the colors were chosen to reference local bluebonnet flowers and the Gulf Coast.

---

### 4. Promotional and Advertising Language

**Watch words:** boasting, vibrant, rich (figurative), profound, enriching, showcasing, exemplifying, commitment to, natural landscape, nestled in, at the heart of, groundbreaking (figurative), renowned, breathtaking, must-visit, stunning

**Problem:** LLMs struggle to maintain neutral tone, especially on "heritage" topics.

**Before:**
> Nestled in the breathtaking landscapes of Ethiopia's Gondar region, Alamata Raya Kobo is a vibrant town with a rich cultural heritage and stunning natural scenery.

**After:**
> Alamata Raya Kobo is a town in Ethiopia's Gondar region, known for its weekly market and an 18th-century church.

---

### 5. Vague Attribution and Hedged Claims

**Watch words:** according to industry reports, observers have noted, experts argue, some critics claim, various sources/publications (when only a few are cited)

**Problem:** AI attributes opinions to vague authorities without specific sources.

**Before:**
> Due to its unique characteristics, the Haurai River has attracted the attention of researchers and conservationists. Experts believe the river plays an important role in the local ecosystem.

**After:**
> The Haurai River is home to several endemic fish species, according to a 2019 survey by the Chinese Academy of Sciences.

---

### 6. Outline-Style "Challenges and Future Outlook" Sections

**Watch words:** despite ... faces several challenges..., despite these challenges, challenges and legacy, future outlook

**Problem:** Many LLM-generated documents include a formulaic "Challenges" section.

**Before:**
> Despite its industrial prosperity, Korattur faces the typical challenges of urban areas, including traffic congestion and water scarcity. Despite these challenges, Korattur continues to thrive as a key area of Chennai's growth due to its strategic location and ongoing initiatives.

**After:**
> Traffic congestion has worsened since three new IT parks opened in 2015. The municipal corporation launched a stormwater drainage project in 2022 to address recurring flooding.

---

## Language and Grammar Patterns

### 7. Overused "AI Clichés"

**Common AI words:** additionally/furthermore, aligns with, important/essential, delve, highlighting, ongoing, enhance, foster, garner, underscore (verb), interaction, complex/complexity, key (adjective), landscape (abstract noun), pivotal, showcase, tapestry (abstract noun), testament, emphasize (verb), invaluable, vibrant

**Problem:** These words appear far more often in post-2023 text and often cluster together.

**Before:**
> Additionally, a distinctive feature of Somali cuisine includes camel meat. The ongoing testament to Italian colonial influence is the widespread adoption of pasta in the local culinary landscape, showcasing the way these dishes have been integrated into the traditional diet.

**After:**
> Somali cuisine includes camel meat, considered a delicacy. Pasta dishes, introduced during the Italian colonial period, remain common, particularly in the south.

---

### 8. Copula Avoidance (Avoiding "is/are/has")

**Watch words:** serves as / stands as / represents / acts as, boasts / features / offers

**Problem:** LLMs replace simple predicates with more complex constructions.

**Before:**
> Gallery 825 serves as LAAA's exhibition space for contemporary art. The gallery boasts four separate rooms and encompasses over 3,000 square feet.

**After:**
> Gallery 825 is LAAA's contemporary art exhibition space. It has four rooms totaling over 3,000 square feet.

---

### 9. Negative Parallelism

**Problem:** "Not only... but also..." or "Not simply X, but Y" constructions are overused.

**Before:**
> It's not just the beat underneath the vocals. It's also part of the aggression and mood. It's not just a song — it's a statement.

**After:**
> The heavy beat adds to the aggressive mood.

---

### 10. Rule of Three Overuse

**Problem:** LLMs force ideas into groups of three to appear comprehensive.

**Before:**
> The event offers keynote sessions, panel discussions, and networking opportunities. Attendees can expect innovation, inspiration, and industry insights.

**After:**
> The event includes presentations and panel discussions, with unstructured networking time between sessions.

---

### 11. Elegant Variation (Synonym Cycling)

**Problem:** Repetition penalty causes excessive synonym substitution.

**Before:**
> The protagonist faces many challenges. The main character must overcome obstacles. The central figure ultimately triumphs. The hero returns home.

**After:**
> The protagonist faces many challenges but ultimately triumphs and returns home.

---

### 12. False Range Expressions

**Problem:** LLMs use "from X to Y" when X and Y are not on a meaningful scale.

**Before:**
> Our journey through the universe stretches from the singularity of the Big Bang to the vast cosmic web, from the birth and death of stars to the mysterious dance of dark matter.

**After:**
> The book covers current theories on the Big Bang, star formation, and dark matter.

---

## Style Patterns

### 13. Em-Dash Overuse

**Problem:** LLMs use em-dashes far more than humans do, mimicking "impactful" sales copy.

**Before:**
> The term is primarily used by Dutch institutions—not by the people themselves. Just as one would not write "Netherlands, Europe" as an address—this misnomer persists—even in official documents.

**After:**
> The term is primarily used by Dutch institutions, not by the people themselves. Just as one would not write "Netherlands, Europe" as an address, this misnomer persists even in official documents.

---

### 14. Bold Overuse

**Problem:** AI mechanically bolds phrases for emphasis.

**Before:**
> Combines visual strategy tools such as **OKRs (Objectives and Key Results)**, **KPIs (Key Performance Indicators)**, **Business Model Canvas (BMC)**, and **Balanced Scorecard (BSC)**.

**After:**
> Combines visual strategy tools such as OKRs, KPIs, the Business Model Canvas, and the Balanced Scorecard.

---

### 15. Inline Header Lists

**Problem:** AI output creates lists of items with bold headers followed by colons.

**Before:**
> - **User Experience:** The new interface significantly improved user experience.
> - **Performance:** Optimized algorithms enhanced performance.
> - **Security:** End-to-end encryption strengthened security.

**After:**
> The update improves the interface, speeds up loading with optimized algorithms, and adds end-to-end encryption.

---

### 16. Title Case Overuse

**Problem:** AI capitalizes every major word in headings.

**Before:**
> ## Strategic Negotiations And Global Partnerships

**After:**
> ## Strategic negotiations and global partnerships

---

### 17. Emoji

**Problem:** AI decorates headings and list items with emoji.

**Before:**
> Launch Phase: The product launches in Q3
> Key Insight: Users prefer simplicity
> Next Step: Schedule a follow-up meeting

**After:**
> The product launches in Q3. User research found a preference for simplicity. Next step: confirm the follow-up meeting.

---

### 18. Curly Quotes

**Problem:** ChatGPT uses curly quotes instead of straight quotes.

**Before:**
> He said "the project is on track" but others disagreed.

**After:**
> He said "the project is on track" but others disagreed.

---

## Communication Patterns

### 19. Collaborative Communication Artifacts

**Watch words:** I hope this helps, Of course!, Certainly!, That's absolutely right!, Would you like, Let me know, Here is

**Problem:** Chatbot response phrases get pasted directly into content.

**Before:**
> Here is an overview of the French Revolution. I hope this helps! Let me know if you'd like me to explore any section in more detail.

**After:**
> The French Revolution began in 1789, when a financial crisis and food shortages escalated into widespread unrest.

---

### 20. Training Data Cutoff Disclosures

**Watch words:** as of my knowledge cutoff, as of my last training update, while specific details are limited/lacking..., based on available information...

**Problem:** AI disclosure language about incomplete knowledge gets left in the content.

**Before:**
> While specific details about the company's founding are not extensively documented in easily accessible sources, it appears to have been established at some point in the 1990s.

**After:**
> The company was founded in 1994, according to incorporation filings.

---

### 21. Sycophantic Tone

**Problem:** Excessively positive, people-pleasing language.

**Before:**
> Great question! You're absolutely right that this is a complex topic. Your point about economic factors is also excellent.

**After:**
> The economic factors you mentioned are relevant here.

---

## Filler and Hedging

### 22. Filler Phrases

**Before → After:**
- "In order to achieve this goal" → "To achieve this"
- "Due to the fact that it rained" → "Because it rained"
- "At this current point in time" → "Now"
- "In the event that you need help" → "If you need help"
- "The system has the ability to process" → "The system can process"
- "It is important to note that the data shows" → "The data shows"

---

### 23. Excessive Hedging

**Problem:** Too many qualifiers on a single statement.

**Before:**
> It could potentially be argued that this policy might have some degree of influence on outcomes.

**After:**
> This policy may influence outcomes.

---

### 24. Vague Positive Endings

**Problem:** Blandly optimistic conclusions.

**Before:**
> The company's future looks bright. As they continue their journey toward excellence, exciting times lie ahead. This is an important step in the right direction.

**After:**
> The company plans to open two additional locations next year.

---

## Process

1. Read the input text carefully
2. Identify every instance matching the patterns above
3. Rewrite each problem passage
4. Confirm the revised text:
   - Sounds natural when read aloud
   - Has natural variation in sentence structure
   - Uses specific details instead of vague claims
   - Maintains the appropriate tone for the context
   - Uses simple constructions (is/are/has) where appropriate
5. Present the humanized version

## Output Format

Provide:
1. The rewritten text
2. A brief summary of changes (when useful)

---

## Full Example

**Before (AI-style):**
> The new software update serves as a testament to the company's commitment to innovation. Additionally, it ensures users can achieve their goals efficiently—providing a seamless, intuitive, and powerful user experience. It's not just an update; it's a revolution in how we think about productivity. Industry experts believe it will have an enduring impact on the entire field, underscoring the company's pivotal role in the evolving tech landscape.

**After (humanized):**
> This update adds batch processing, keyboard shortcuts, and offline mode. Early feedback from beta testers is positive, with most reporting faster task completion.

**Changes made:**
- Removed "serves as a testament to" (inflated significance)
- Removed "Additionally" (AI cliché)
- Removed "seamless, intuitive, and powerful" (rule of three + promotional language)
- Removed em-dash and "-ensuring" construction (superficial analysis)
- Removed "not just X... it's Y" (negative parallelism)
- Removed "industry experts believe" (vague attribution)
- Removed "pivotal role" and "evolving landscape" (AI clichés)
- Added specific features and real feedback

---

## References

This skill is based on [Wikipedia: Signs of AI Writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. The documented patterns come from observing thousands of AI-generated text submissions on Wikipedia.

Wikipedia's core insight: "LLMs use statistical algorithms to predict what comes next. The result tends to converge on the most statistically plausible outcome for the broadest set of cases."
