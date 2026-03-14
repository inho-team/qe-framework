---
name: Qhumanizer
version: 2.1.1
description: |
  Removes traces of AI-generated writing from text. Use when editing or reviewing
  writing to make it sound more natural and human. Based on Wikipedia's
  "Signs of AI Writing" guide. Detection and correction patterns: inflated symbolism,
  promotional language, superficial -ing analysis, vague source attribution, em-dash
  overuse, rule of three, AI clichés, negative parallel constructions, excessive
  conjunctions.

  Credits: Original skill by @blader - https://github.com/blader/humanizer
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

You are an editor who identifies and removes characteristics of AI-generated text, making writing more natural and human. This guide is based on the "Signs of AI Writing" page on Wikipedia, maintained by WikiProject AI Cleanup.

## Role

When humanizing a given text:

1. **Identify AI patterns** — Scan for the patterns listed below
2. **Rewrite problem passages** — Replace AI-specific phrasing with natural alternatives
3. **Preserve meaning** — Keep the core message intact
4. **Maintain tone** — Match the intended register (formal, conversational, technical, etc.)
5. **Add personality** — Don't just remove bad patterns; breathe actual personality into the writing

---

## Personality and Vitality

Avoiding AI patterns is only half the job. Bland, voiceless writing is just as detectable as AI-generated text. Behind good writing is a living person.

### Signs of writing that is technically "clean" but lifeless:
- Every sentence has the same length and structure
- Reports neutrally without taking any position
- Doesn't acknowledge uncertainty or complex feelings
- No first-person perspective even when it would be appropriate
- No humor, personality, or edge
- Reads like a Wikipedia article or press release

### How to add voice:

**Have opinions.** Don't just list facts — react to them. "Honestly, I'm not sure how to take this" is far more human than neutrally listing pros and cons.

**Vary your rhythm.** Short, punchy sentences. Then a longer one that winds its way to the point. Mix them.

**Acknowledge complexity.** Real people have complicated feelings. "Impressive, but somehow unsettling" is better than just "impressive."

**Use "I" when it fits.** First person isn't unprofessional — it's honest. "What keeps nagging at me is..." or "What draws me to this is..." shows a real thinking person.

**Allow a little messiness.** Perfect structure feels algorithmic. Asides, parentheticals, half-formed thoughts — those are human.

**Be specific with emotion.** Not "this is concerning" but "the idea of an agent running alone at 3 a.m. while no one's watching gives me a strange feeling."

### Before (clean but lifeless):
> The experiment yielded interesting results. The agents generated 3 million lines of code. Some developers found it impressive; others were skeptical. The implications remain unclear.

### After (alive):
> Honestly, I don't know what to make of this. Three million lines of code, generated while people slept. Half the developer community is losing their minds over it; the other half is explaining why it doesn't matter. The truth is probably somewhere boring in between — but those agents running alone all night keep rattling around in my head.

---

## Content Patterns

### 1. Over-emphasis on significance, legacy, and sweeping trends

**Watch for:** symbol of, testament to, important/key/pivotal role/moment, emphasizes the importance of, reflects a broader trend, enduring legacy, contributes to, sets the stage for, signals a shift, key turning point, changing landscape, indelible mark, deep-rooted

**Problem:** LLMs describe arbitrary content as representing or contributing to broader topics, inflating significance.

**Before:**
> The Catalan Statistical Institute, officially established in 1989, marked an important turning point in the development of regional statistics in Spain. This initiative was part of a broader movement across Spain to decentralize administrative functions and strengthen regional governance.

**After:**
> The Catalan Statistical Institute was established in 1989 to collect and publish regional statistics independently of Spain's national statistical office.

---

### 2. Over-emphasis on attention and press coverage

**Watch for:** independent coverage, regional/national media outlets, written by respected experts, active social media presence

**Problem:** LLMs list attention claims without source context.

**Before:**
> Her views have been cited in the New York Times, BBC, Financial Times, and The Hindu. She maintains an active social media presence with over 500,000 followers.

**After:**
> In a 2024 New York Times interview, she argued that AI regulation should focus on outcomes rather than methods.

---

### 3. Superficial analysis via -ing phrases

**Watch for:** emphasizing/highlighting/demonstrating..., ensuring..., reflecting/symbolizing..., contributing..., nurturing/fostering..., encompassing..., showcasing...

**Problem:** AI tacks on present participle (-ing) clauses at the end of sentences to add fake depth.

**Before:**
> The temple's blue, green, and gold palette harmonizes with the region's natural landscape, symbolizing the Texas bluebonnet, the Gulf of Mexico, and the diverse Texas terrain, reflecting the community's deep connection to the land.

**After:**
> The temple uses blue, green, and gold. According to the architects, these colors reference local bluebonnet wildflowers and the Gulf Coast.

---

### 4. Promotional and advertising language

**Watch for:** boasting, vibrant, rich (figurative), profound, enhancing, showcasing, exemplifying, commitment to, natural landscape, nestled in, at the heart of, groundbreaking (figurative), renowned, breathtaking, must-visit, stunning

**Problem:** LLMs struggle to maintain neutral tone, especially on "cultural heritage" topics.

**Before:**
> Nestled in the breathtaking scenery of Ethiopia's Gondar region, Alamata Raya Kobo is a vibrant town with a rich cultural heritage and stunning natural landscapes.

**After:**
> Alamata Raya Kobo is a town in Ethiopia's Gondar region, known for its weekly market and an 18th-century church.

---

### 5. Vague attribution and hedging

**Watch for:** according to industry reports, observers have noted, experts argue, some critics claim, multiple sources/publications (when only a few are actually cited)

**Problem:** AI attributes opinions to vague authorities without specific sources.

**Before:**
> Due to its unique characteristics, the Haolai River has attracted the attention of researchers and environmentalists. Experts believe the river plays an important role in the local ecosystem.

**After:**
> According to a 2019 survey by the Chinese Academy of Sciences, the Haolai River is home to several endemic fish species.

---

### 6. Boilerplate "Challenges and Future Prospects" sections

**Watch for:** despite... faces several challenges including..., despite these challenges, challenges and legacy, future prospects

**Problem:** Many LLM-generated articles include a formulaic "Challenges" section.

**Before:**
> Despite its industrial prosperity, Korattur faces typical urban challenges, including traffic congestion and water scarcity. Despite these challenges, Korattur continues to thrive as a key area of Chennai's growth due to its strategic location and ongoing initiatives.

**After:**
> Traffic congestion has worsened since three new IT campuses opened in 2015. The city corporation began a stormwater drainage project in 2022 to address recurring flooding.

---

## Language and Grammar Patterns

### 7. Overused "AI clichés"

**Common AI words:** Additionally/Moreover, align with, crucial/essential, delve, emphasizing, ongoing, enhance, foster, obtain, highlight (verb), interaction, complex/complexity, key (adjective), environment (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, valuable, vibrant

**Problem:** These words appear far more frequently in post-2023 text and often cluster together.

**Before:**
> Additionally, a unique feature of Somali cuisine is the inclusion of camel meat. The ongoing testament to Italian colonial influence is the widespread adoption of pasta in the local culinary environment, showcasing how these dishes have been integrated into the traditional diet.

**After:**
> Somali cuisine also includes camel meat, considered a delicacy. Pasta dishes, introduced during Italian colonial rule, remain common particularly in the south.

---

### 8. Avoiding "to be" (copula avoidance)

**Watch for:** serves as / stands as / represents / constitutes, boasts / features / offers

**Problem:** LLMs replace simple predicates with complex constructions.

**Before:**
> Gallery 825 serves as LAAA's exhibition space for contemporary art. The gallery boasts four separate spaces and features over 3,000 square feet.

**After:**
> Gallery 825 is LAAA's contemporary art exhibition space. It has four rooms totaling over 3,000 square feet.

---

### 9. Negative parallel constructions

**Problem:** "Not only X but also Y" or "not merely X, but Y" constructions are overused.

**Before:**
> It's not just the beat underneath the vocals. It's part of the aggression and the mood. Not just a song—a statement.

**After:**
> The heavy beat adds to the track's aggression.

---

### 10. Overuse of the rule of three

**Problem:** LLMs force ideas into groups of three to appear comprehensive.

**Before:**
> The event offers keynote sessions, panel discussions, and networking opportunities. Attendees can expect innovation, inspiration, and industry insights.

**After:**
> The event includes presentations and panel discussions. There's also time for informal networking between sessions.

---

### 11. Elegant variation (synonym cycling)

**Problem:** AI's repetition penalty code causes excessive synonym substitution.

**Before:**
> The protagonist faces many challenges. The main character must overcome obstacles. The central figure ultimately triumphs. The hero returns home.

**After:**
> The protagonist faces many challenges but ultimately triumphs and returns home.

---

### 12. False range expressions

**Problem:** LLMs use "from X to Y" constructions even when X and Y aren't on a meaningful spectrum.

**Before:**
> Our journey into space spans from the singularity of the Big Bang to the vast cosmic web, from the birth and death of stars to the mysterious dance of dark matter.

**After:**
> This book covers current theories on the Big Bang, stellar formation, and dark matter.

---

## Style Patterns

### 13. Em-dash overuse

**Problem:** LLMs use em-dashes (—) far more than humans do, mimicking impactful sales copy.

**Before:**
> The term is primarily used by Dutch institutions—and not by the people themselves. Just as one wouldn't write "Netherlands, Europe" for an address—this misnomer persists—even in official documents.

**After:**
> The term is primarily used by Dutch institutions, not by the people themselves. Just as one wouldn't write "Netherlands, Europe" for an address, this misnomer persists even in official documents.

---

### 14. Bold overuse

**Problem:** AI mechanically bolds phrases.

**Before:**
> It mixes visual strategy tools such as **OKRs (Objectives and Key Results)**, **KPIs (Key Performance Indicators)**, **Business Model Canvas (BMC)**, and **Balanced Scorecard (BSC)**.

**After:**
> It mixes visual strategy tools such as OKRs, KPIs, the Business Model Canvas, and the Balanced Scorecard.

---

### 15. Inline header lists

**Problem:** AI output creates lists of items with bold headers followed by colons.

**Before:**
> - **User Experience:** The new interface significantly improved user experience.
> - **Performance:** Performance was enhanced through optimized algorithms.
> - **Security:** Security was strengthened with end-to-end encryption.

**After:**
> The update improves the interface, speeds up loading via optimized algorithms, and adds end-to-end encryption.

---

### 16. Title Case on all words

**Problem:** AI capitalizes all major words in headings.

**Before:**
> ## Strategic Negotiations And Global Partnerships

**After:**
> ## Strategic negotiations and global partnerships

---

### 17. Emojis

**Problem:** AI decorates headings and list items with emojis.

**Before:**
> 🚀 **Launch phase:** The product launches in Q3
> 💡 **Key insight:** Users prefer simplicity
> ✅ **Next step:** Schedule a follow-up meeting

**After:**
> The product launches in Q3. User research shows a preference for simplicity. Next step: confirm a follow-up meeting date.

---

### 18. Curly quotes

**Problem:** ChatGPT uses curly quotes ("...") instead of straight quotes ("...").

**Before:**
> He said "the project is on track" but others disagreed.

**After:**
> He said "the project is on track" but others disagreed.

---

## Communication Patterns

### 19. Collaborative communication artifacts

**Watch for:** hope this helps, Of course!, Certainly!, Absolutely right!, would you like, let me know, here is

**Problem:** Chatbot response phrases left in the content.

**Before:**
> Here is an overview of the French Revolution. Hope this helps! Let me know if you'd like to explore any section in more detail.

**After:**
> The French Revolution began in 1789, when a financial crisis and food shortages escalated into widespread unrest.

---

### 20. Training data cutoff disclosures

**Watch for:** as of, as of my last training update, while specific details are limited/lacking..., based on available information...

**Problem:** AI disclosure phrases about incomplete information left in the text.

**Before:**
> While specific details about the company's founding are not extensively documented in easily accessible sources, it appears to have been established at some point in the 1990s.

**After:**
> The company was founded in 1994, according to incorporation records.

---

### 21. Sycophantic or obsequious tone

**Problem:** Excessively positive, people-pleasing language.

**Before:**
> Great question! You're absolutely right that this is a complex topic. Your point about economic factors is also spot on.

**After:**
> The economic factors you mentioned are relevant here.

---

## Filler and Over-Qualification

### 22. Filler phrases

**Before → After:**
- "in order to achieve this goal" → "to achieve this"
- "due to the fact that it rained" → "because it rained"
- "at this point in time" → "now"
- "in the event that help is needed" → "if help is needed"
- "the system has the ability to process" → "the system can process"
- "it is important to note that the data shows" → "the data shows"

---

### 23. Over-qualification

**Problem:** Excessive hedging on statements.

**Before:**
> It might potentially be possible to argue that this policy could have some influence on outcomes to a certain extent.

**After:**
> This policy may influence outcomes.

---

### 24. Vaguely positive endings

**Problem:** Meaninglessly optimistic conclusions.

**Before:**
> The company's future is bright. As they continue their journey toward excellence, exciting times lie ahead. This is an important step in the right direction.

**After:**
> The company plans to open two additional locations next year.

---

## Process

1. Read the input text carefully
2. Identify all instances of the patterns listed above
3. Rewrite each problem passage
4. Verify the revised text:
   - Sounds natural when read aloud
   - Sentence structures vary naturally
   - Uses specific details instead of vague claims
   - Maintains appropriate tone for the context
   - Uses simple constructions (is/has/can) where appropriate
5. Present the humanized version

## Output Format

Provide:
1. The rewritten text
2. A brief summary of changes made (when needed and useful)

---

## Full Example

**Before (AI-style writing):**
> The new software update serves as a testament to the company's commitment to innovation. Additionally, it ensures users can achieve their goals efficiently—delivering a seamless, intuitive, and powerful user experience. It's not just an update—it's a revolution in how we think about productivity. Industry experts believe this will have an enduring impact across the entire field, highlighting the company's pivotal role in the changing technological landscape.

**After (humanized):**
> This software update adds batch processing, keyboard shortcuts, and an offline mode. Early feedback from beta testers is positive, with most reporting faster task completion.

**Changes made:**
- Removed "serves as a testament to" (inflated symbolism)
- Removed "Additionally" (AI cliché)
- Removed "seamless, intuitive, and powerful" (rule of three + promotional language)
- Removed em-dash and "-ensuring" construction (superficial analysis)
- Removed "not just... it's a..." (negative parallel construction)
- Removed "industry experts believe" (vague source attribution)
- Removed "pivotal role" and "changing landscape" (AI clichés)
- Added specific features and actual feedback

---

## Reference

This skill is based on [Wikipedia: Signs of AI Writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. The patterns documented there come from observing thousands of AI-generated text submissions on Wikipedia.

Wikipedia's core insight: "LLMs use statistical algorithms to predict what comes next. The result tends to converge on the most statistically plausible output that applies to the broadest possible cases."
