# AIS-OS Intake

This is the source-of-truth file for your AIOS. Fill it in by typing, voice-pasting (Wispr Flow / OS dictation), or running `/onboard` for a guided conversation. Whichever mode, this file is what `/onboard` reads to scaffold your Day-1 setup.

**Hard cap: 7 questions.** Each answerable in under 60 seconds. Don't overthink — you can edit and re-run `/onboard` any time.

---

## Q1 — Who are you, what do you sell, who do you sell it to?

Identity, offer, ICP. One paragraph each is fine.

```
Identity: Martin, a software developer who graduated ~6 months ago. Building my own business and personal brand.

Offer: AI and non-AI automations for other businesses, plus custom web-based systems. Flagship product: a quoting + process-digitalization system built for a local print shop (speeds up how fast employees draft quotes and digitalizes the workflow around it). Plan is to enhance it and sell it to similar businesses. Also interested in web design (using tools like Claude and Higgsfield) and digital marketing, specifically the CRM side.

ICP: Small/local businesses like print shops — operations-heavy, manual-quoting, ripe for digitalization. Plus businesses needing custom web systems, web design, or CRM/marketing automation.
```

---

## Q2 — Paste 1-2 things you've written recently. Don't edit them.

An email, a LinkedIn post, a DM, a doc — anything that sounds like you when you're not trying. **Paste verbatim.** Do not type these mid-conversation with Claude — chat-shaped samples are worse than no samples (voice contamination).

```
Sample 1 — Skool community intro (English):
Hi everyone, Martin here, been following Nate's videos on Youtube for a while and finally decided to jump in the Skool boat. Thanks for having me!
```

```
Sample 2 — Email to a SAP ABAP course teacher (Spanish, native language):
Hola Ricardo.

Tengo una duda con respecto al examen final que creo ya la habían aclarado en algún momento pero agradecería si pudieras confirmarme si era así. El examen según tengo entendido solo constara de lo que vimos en el bootcamp hasta la fecha en que dejamos de tener las sesiones de coaching, es decir que no incluirá material de estos últimos temas relacionados a FIORI o RAP ¿No es así?

Desde ya muchas gracias, espero que tengas un buen día.

Nos vemos el jueves.
Martín Fernández Santía.
```

---

## Q3 — What are your 2-3 biggest priorities for the next 90 days?

Quarterly priorities. Not yearly aspirations. Things that, if not done by July, would make you say "I wasted Q2."

```
1. Finish setting up this AIOS for good — turn it into my operations center (spin up / automate things like social posts) and my knowledge base (learnings, notes, ideas).
2. (TOP PRIORITY) Fully enhance and revamp the print-shop quoting system, then start selling it to other businesses.
3. Spin up my social networks and start regular, scheduled posts to build my personal brand.
4. Update and enhance my dad's real-estate business website, and help him spin up his social networks to bring in more clients.
```

---

## Q4 — Where does revenue actually land, and where is it tracked?

Multiple answers OK. Stripe? Skool? GoHighLevel? QuickBooks? A spreadsheet?

```
Cash only so far (single print-shop client). No tracking anywhere — I know roughly how much came in, but not where it's going. No invoicing/accounting tool yet.
```

---

## Q5 — Where do you talk to customers, your team, and the outside world day-to-day?

Email (which one — Gmail / Outlook)? Slack? Teams? DMs (Skool / Discord / iMessage)? Phone?

```
WhatsApp only right now — and it's my personal number. No business email, Slack, or separate channels yet. (Email on file: martin-santia@hotmail.com.ar / Outlook.)
```

---

## Q6 — Where do meeting recordings, notes, and important docs live?

Granola? Otter? Fireflies? Google Drive? Notion? Dropbox? A folder on your desktop you keep meaning to organize?

```
Nowhere — no system yet. Notes, learnings, ideas, and docs are unmanaged.

TOOL CONSTRAINTS (apply to any future recommendation): (1) must be free or have an open-source version I can self-host on my computer; (2) must be able to connect to Claude (e.g. via MCP).
```

---

## Q7 — What's the one task that eats your week, and where do you currently track work?

The single biggest time-suck or recurring drudgery. Plus where tasks/projects live (ClickUp / Asana / Linear / Notion / a notebook).

```
Top pain (two parts):
1. Multiple live projects at once with no set goals or visible steps — no way to see I'm advancing, and no signal for when to stop one and switch to another. Lack of prioritization/progress visibility across projects.
2. Spending too much time debating in different Claude sessions HOW to handle things instead of actually doing the work. Analysis/planning loops eat time that should be execution.

Where work is tracked: nowhere — it all lives in my head.
```

---

When this file is filled, run `/onboard` (or re-run it) and the wizard will scaffold your Day-1 file set: `context/`, `references/voice.md`, populated `connections.md`, and a filled `CLAUDE.md`.
