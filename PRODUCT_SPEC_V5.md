# AGENT ACADEMY — FULL PRODUCT SPEC v5
# Written: April 2026
# Status: Source of truth for all builds

---

# PART 1 — ROADMAP

## The Product in One Sentence
You describe your workflow in plain English. We build you an AI agent that runs it. You pay us to keep it running.

## The Business Model in One Sentence
We build it once. You run it forever. Every failure makes it smarter. You never leave because turning it off means losing something that works.

---

## PHASE PRIORITIES

### PHASE 1 — DEFINE + PREVIEW (ship now)
What: Adaptive minimum-step intake with live sandbox running in parallel.
Why first: This is the product demo. The moment a user uploads a real file and watches their agent process it during build — that is the conversion event. Everything else depends on this being real and fast.
Done when: User completes minimum required steps, sandbox has processed at least one real input, working agent launches.

### PHASE 2 — DEPLOY (next)
What: Blueprint → Claude Code → hosted agent on our infrastructure.
Why second: The intake means nothing if the agent doesn't run. The business model doesn't exist until we're hosting agents.
Done when: User clicks Launch, agent deploys, endpoint is live, first monitored run completes.

### PHASE 3 — MONITOR
What: Run logs, success/failure tracking, cost per run, performance over time.
Done when: Every agent run is logged, dashboard shows run history, failure types are classified.

### PHASE 4 — IMPROVE (the flywheel)
What: Failure → diagnosis → fix suggestion → one-click apply → redeploy → compare.
Done when: Three failure patterns auto-detected and surfaced with fix options.

### PHASE 5 — EXPAND
What: Second agent, cross-agent workflows, team access, vertical templates.
Done when: User can build a second agent that passes data to the first.

---

## BUILD PRIORITY STACK

| # | What | Phase |
|---|------|-------|
| 1 | Adaptive SmartIntake v6 (minimum viable steps) | Now |
| 2 | Live sandbox during build | Now |
| 3 | Industry detection and coaching | Now |
| 4 | Silent routing + conflict detection | Now |
| 5 | Blueprint JSON spec (deployable) | Now |
| 6 | Supabase: agents + runs + documents | Now |
| 7 | Claude Code blueprint handoff | 2 |
| 8 | Hosted agent execution (Railway) | 2 |
| 9 | Run logging + agent_runs table | 3 |
| 10 | Dashboard: runs, cost, failures | 3 |
| 11 | Failure classification + suggestions | 4 |
| 12 | Revision loop: LLM chat + step editor | 4 |
| 13 | Template mapping refinement session | 4 |
| 14 | Pricing trigger (1 free run, configurable) | 2 |
| 15 | Payment layer (Stripe) | 2 |
| 16 | Second agent + cross-agent | 5 |

---

# PART 2 — CORE UX PRINCIPLE (read this first)

---

## THE MINIMUM VIABLE AGENT PRINCIPLE

The goal of the intake is to get the user to a working agent in the minimum number of exchanges.

Not 10 steps. Not a fixed flow. The minimum number of questions needed to launch something that works.

The app determines step count. The user never sees a progress bar that says "Step 3 of 10." They see a conversation that ends when the agent is ready to launch.

---

## ADAPTIVE STEP COUNT

Classification at the pre-step determines which steps are required for THIS specific agent:

SIMPLE AGENTS (summarize, extract, classify):
Required steps: What it reads + What it produces + Name
Typical: 3 exchanges, under 5 minutes
Examples: RFI summarizer, invoice extractor, resume screener, document classifier

MEDIUM AGENTS (structured output, template filling):
Required steps: What it reads + Output format + Name
Optional if user mentions: Standing context
Typical: 3-4 exchanges, under 8 minutes
Examples: Submittal log builder, CO notice generator, expense report filler

COMPLEX AGENTS (multi-doc, cross-reference, judgment calls):
Required steps: What it reads + Standing context + What it produces + Human gates + Name
Typical: 5 exchanges, under 12 minutes
Examples: RFI triage with contract cross-check, compliance reviewer, bid analysis

Steps that don't apply to this agent type are skipped silently.

---

## WHAT GETS ASKED VS. WHAT GETS ASSUMED

ALWAYS ASKED (minimum viable — every agent needs these):
- What does it read each time?
- What does it produce?
- What do you want to call it?

ASKED ONLY IF RELEVANT TO THIS AGENT TYPE:
- Does it need standing context? (only if agent type benefits)
- Does it follow a specific format? (only if output is structured/templated)
- When should it stop and ask? (only if agent makes consequential decisions)

NEVER ASKED DURING BUILD:
- Anything about legal routing if user just wants analysis
- Anything about response drafting if user just wants summarization
- Anything about integrations if user hasn't mentioned them
- Anything that doesn't change what the agent actually does

THE RULE: If the answer wouldn't change what the agent does, don't ask the question.

---

## SMART DEFAULTS FOR EVERYTHING OPTIONAL

Agent launches with smart defaults for anything not explicitly defined:

TEMPLATE not uploaded:
Agent produces best-effort structured output using industry standard format.
Dashboard queues: "Add your template to lock in your exact format."

STANDING CONTEXT not uploaded:
Agent runs on runtime input only using industry knowledge baseline.
Dashboard improvement queue: "Adding your contract/specs/SOPs would significantly improve accuracy."

LEARNING EXAMPLES not provided:
Agent uses industry knowledge baseline.
Dashboard surfaces after run 5: "Your first 5 runs show us what to calibrate. Add examples now?"

HUMAN GATES not configured:
Smart defaults applied by agent type:
- Document processors → "Always show output before saving"
- Classifiers → "Flag when confidence below 80%"
User adjusts anytime from dashboard.

---

## TEMPLATE MAPPING — LAUNCH FAST, REFINE IN DASHBOARD

DURING BUILD:
App reads uploaded template. Makes best-effort automated mapping.
Handles 90%+ of cases correctly.
Agent launches on that mapping immediately.
No cell-by-cell review required before launch. No blocking.

AFTER LAUNCH (dashboard mapping session):
"Let's make sure your template is perfectly mapped."
User chats with LLM in plain English:
"That column is the RFI number, not the date."
"The approval field should auto-fill from the standing context."
LLM updates mapping. Agent incorporates immediately. No redeploy needed.

The build session never becomes a mapping session. The dashboard is where precision lives.

---

## NO GATES, BARRIERS, OR BLOCKS

Nothing prevents launch except:
- No concept defined (impossible to build without it)
- No output defined (impossible to build without it)

Everything else is optional. Agent launches in a functional-but-incomplete state and improves through use.

The sandbox test at step-end SHOWS the user their agent working. It does not block launch if output isn't perfect. User decides:
"This is close enough → Launch"
"One thing is off → back to that step" (one change, then launch)

---

## ARCHITECTURE RELIABILITY — NON-NEGOTIABLE UNDERNEATH

Simple UX does not mean fragile architecture. Under the surface always:

- State persisted before returning (no data loss on crash or timeout)
- Every run logged with full metadata (no silent failures)
- Failure types classified immediately (not just "error" — specific type and cause)
- Human gates enforced when configured (agent cannot take external action without approval)
- Template mapping attempted completely (best effort is a real attempt, not a guess)
- pgvector index maintained even if document library starts empty (ready when documents added)
- Retry logic on transient failures (network, API rate limit, timeout — 3 attempts, then log and notify)
- Graceful degradation on standing context miss (proceeds with caveat logged, gaps surfaced in dashboard)

The user experience is simple. The infrastructure is production-grade. These are not in conflict — they are both required.

---

# PART 3 — FULL PRODUCT SPEC

---

## DESIGN PRINCIPLES

1. LAYMAN'S LANGUAGE, ARCHITECT'S PRECISION
Every question written for someone who has never heard of an AI agent. Every answer captured with enough precision to deploy production code. The translation between these two is the entire product.

2. THE APP KNOWS THE INDUSTRY. THE USER KNOWS THEIR COMPANY.
Claude provides industry depth. The intake extracts company depth — how this specific company handles it, their standards, their workflows, their edge cases. Neither alone is enough.

3. SILENT ROUTING BEATS ERROR MESSAGES
When a user mentions contracts in the inputs step, the app tags it as standing context and surfaces it in the right section. Never tells the user they did something wrong. Architecture invisible. Outcome correct.

4. THE SANDBOX IS THE PRODUCT
The intake is just the onboarding flow for the sandbox. By the third exchange the user should have uploaded a real file and seen their agent produce real output. Build and use are the same experience.

5. ONE FREE RUN. THEN PAY.
The conversion moment is when the agent processes their real data correctly. That happens during build, before payment. When they hit Launch, they've already seen it work. They're paying to keep something that works.

6. EVERY FAILURE IS A PRODUCT OPPORTUNITY
A failure is a data point. It tells us what to fix, what to surface in the dashboard, what coaching to improve. The improvement flywheel runs on failures.

---

## PRE-STEP: INDUSTRY AND WORKFLOW DETECTION

Single opening screen with one field:
"What do you want to automate? Describe it in plain English — what you do today and what you wish happened automatically."

This is classification, not step 1.

CLASSIFICATION PROMPT RETURNS:
{
  "industry": "construction",
  "workflow_type": "rfi_triage",
  "agent_class": "document_processor",
  "complexity": "simple|medium|complex",
  "required_steps": ["concept", "inputs", "outputs", "name"],
  "optional_steps": ["standing_context", "template", "human_gates"],
  "coaching_depth": "deep|standard|generic",
  "clarifying_question": "one question if confidence below 0.85, otherwise null"
}

The required_steps array determines what gets asked.
The user never sees or knows about this classification.
The app never shows a dropdown. The user never picks an industry.

---

## STEP: CONCEPT (always required)

Headline: What should your agent do?

User-facing copy:
"Describe it like you're explaining it to a new employee. What does it handle and what do you want back when it's done?"

Coaching behavior:
After 25+ characters, Claude responds with:
- AI Understanding card: one sentence confirming what it understood
- 1-2 gaps with concrete injectable options specific to this workflow
- Options phrased as outcomes, not architecture decisions

Example for RFI agent:
Gap: "What do you want when it's done?"
Options:
- A summary of what's being asked and the risk level
- A full draft response ready for your PM to review
- A structured log entry with RFI number, classification, and recommended action

If the user's description is complete enough to build on (reads X, produces Y), skip the gap prompts entirely and move forward.

Learn More (collapsible):
"The clearer you are about what lands on your desk and what you want back, the better your agent performs. You can always refine this later — for now, give us enough to get started."

---

## STEP: WHAT DOES IT READ? (always required)

Headline: What does it read each time you run it?

User-facing copy:
"Every time you give your agent work, what does it need to look at?"

Industry-aware coaching. For construction RFI:
- The RFI document itself (PDF or Word)
- The RFI plus attachments or referenced drawings
- A batch of RFIs for combined analysis

SILENT ROUTING:
- User mentions contracts, specs, drawings, SOPs, standards → tagged as standing context → if standing_context in required_steps, pre-populates that section
- User mentions past examples, historical records → tagged as learning examples → surfaced in dashboard improvement queue after launch
- No interruption. No error. App handles routing invisibly.

Learn More:
"This is the new work you hand your agent each time — the document that just arrived, the file you need processed right now. Everything your agent always knows about your company lives somewhere else that we set up separately."

---

## STEP: WHAT DOES IT PRODUCE? (always required)

Headline: What do you want on your desk when it's done?

User-facing copy:
"When your agent finishes, what should exist that didn't before? Be specific."

Industry-specific options. For RFI agent:
- A one-page summary: what's being asked, risk level, and suggested action
- A fully drafted response ready for your PM to review and send
- A structured log entry: RFI number, description, classification, status

If user description matches a templated output → step: template is added to required_steps.
If user description is unstructured output → no template step needed, skip it.

Learn More:
"The more specific you are, the more consistent your agent gets. 'A summary' means something different every time. 'A one-page memo with risk rating and recommended response' means the same thing every time."

---

## STEP: STANDING CONTEXT (required for medium/complex agents, optional for simple)

Headline: What does it always need access to?

User-facing copy:
"Some information your agent needs every single time — not something you provide each run, just always available. Upload it once and you never think about it again."

Industry-aware categories surfaced for construction:

CONTRACTS AND SCOPE
"How your agent knows what's included vs. what's a change."
Upload: Subcontract, prime contract, scope of work

SPECIFICATIONS
"What materials and methods are required on this project."
Upload: Project specs (relevant divisions), addenda, bulletins

DRAWINGS
"What was originally designed vs. what's being requested."
Upload: Relevant drawing sets, sheet indexes, ASIs

COMPANY STANDARDS
"How your company does things — your process, your language."
Upload: SOPs, standard response templates, internal guidelines

APPROVED LISTS
"Who you work with and what you use."
Upload: Approved subcontractors, approved products, preferred vendors

CODES AND REGULATIONS
"The rules your agent has to work within."
Upload: Relevant OSHA standards, building codes, local AHJ requirements

HISTORICAL REFERENCE
"How similar situations were handled before."
Upload: Past RFI logs, past CO decisions, resolved disputes

Each category:
- Plain English description
- Upload button (accepts PDF, Word, Excel, CSV)
- "I'll add this later from my dashboard" option

Multiple selections always work. Selecting one never hides others.

FOR NON-CONSTRUCTION INDUSTRIES:
Equivalent categories generated by Claude based on industry.
Same structure, different content. App never shows construction-specific categories to a legal or finance user.

Learn More per category inline on demand:
Contracts: "This is how your agent knows when something is a legitimate change vs. already included in scope — the same judgment call your team makes every time, now consistent and instant."

---

## STEP: OUTPUT TEMPLATE (required only if output is structured/templated)

Headline: Does your agent follow a specific format?

User-facing copy:
"If your company has a standard format for this output, upload it. Your agent will follow your exact structure. If you don't have one, we'll create one for you."

THREE PATHS:

Path A — User uploads template:
App analyzes. Fields categorized:
- CYAN: Fields extracted from source document (auto-filled by agent)
- GOLD: Fields user provides each run (job number, approver name)
- GREY: Fields agent computes (totals, page numbers, dates)
Agent launches on this mapping. Mapping refinement happens in dashboard.

Path B — No template, generate one:
App generates recommended template based on:
- What the agent produces
- Industry standards for this document type
- Fields mentioned throughout the conversation
User sees a preview. Accepts as-is, skips for now, or says what's wrong.
Agent launches with generated template.

Path C — Skip:
Agent produces best-effort structured output. Dashboard queues template upload.

NEVER blocks launch regardless of which path is chosen.

Learn More:
"A template is your agent's style guide. Without one it makes format decisions every time, which means inconsistency. With one, every output looks exactly how your company presents this work. Upload your actual template file — not a description of it."

---

## STEP: HUMAN GATES (required only for complex agents making consequential decisions)

Headline: When should it check with you before acting?

User-facing copy:
"Your agent handles the routine work automatically. These are the moments where it stops and gets you."

TOGGLE-BASED — not text fields. Not open-ended questions.

Coaching generates specific suggestions based on what was defined:

For RFI agent with contracts uploaded:
ALWAYS PAUSE (default ON):
→ Before sending any response to an external party

PAUSE WHEN UNCERTAIN (default ON):
→ When classification confidence is below 80%
→ When the RFI references something not found in uploaded documents

RUN AUTOMATICALLY (default ON):
→ Logging and categorizing an incoming RFI
→ Generating a draft that stays internal until approved

User adjusts each toggle. Done in under 60 seconds.

For simple agents (no external actions, output stays internal):
This step is skipped entirely. Smart defaults applied silently.

Learn More:
"Human gates are the moments your agent knows to stop and get you. A well-designed agent handles routine work automatically and brings you in for judgment calls. This is what makes it trustworthy."

---

## STEP: NAME AND LAUNCH (always last)

Headline: Name it and launch it.

PART A — NAME:
"What do you want to call this agent?"
Suggestions: "RFI Analyst," "Invoice Reader," "Submittal Scout"
One field. Done in 10 seconds.

PART B — PLAIN ENGLISH SUMMARY:
Full recap in plain language:

YOUR AGENT: [Name]

WHAT IT DOES: [one sentence from concept]
WHAT STARTS IT: You upload [input type] directly
WHAT IT READS EACH TIME: [runtime inputs]
WHAT IT ALWAYS HAS ACCESS TO: [standing context list or "nothing yet — you can add this from your dashboard"]
WHAT IT PRODUCES: [output description]
WHEN IT STOPS AND ASKS: [gates summary or "runs automatically — you review the output"]

YOUR FIRST RUN IS FREE. After that, [price]/month keeps it running, monitored, and improving.

PART C — SANDBOX TEST:
"Upload a real example and see what your agent produces."
Not a requirement to launch. A demonstration.

User uploads real file. Sandbox runs. Sees output.
Two options:
- "This looks right → Launch"
- "One thing is off → fix it" → back to the relevant step, one change, then launch

LAUNCH:
- Blueprint compiles to deployable JSON
- Claude Code reads and builds agent
- Agent deploys to Railway
- User gets dashboard link
- Run 1 logged (free)
- Stripe initiated on run 2

---

## SANDBOX — LIVE DURING BUILD

Active from the first step where output can be shown.

THREE STATES:

Waiting:
"Upload something to see your agent work."

Processing (during build):
User uploads real file at any point. Agent processes using current partial definition.
Output improves as more steps complete.
"WHAT WOULD IMPROVE THIS" section drives users forward through remaining steps.

Full agent (at launch step):
Sandbox IS the agent. Same interface. Same upload. Same output.
This run is free. After launch, runs cost money.

WHAT IT SHOWS:
- DETECTED: what type of content this is
- EXTRACTED: key fields pulled from the document
- ANALYSIS: what the agent decided and why — in plain English
- OUTPUT: the actual formatted output — downloadable
- WHAT WOULD IMPROVE THIS: gaps still in the definition

Mobile: bottom sheet. Slides up on tap of "Test it." Slides back when done. Intake continues.

---

## RESPIN BUTTON ON ALL SUGGESTIONS

Every AI-generated suggestion has:
- USE THIS
- ADJUST (text field: "what's wrong with this?" → regenerates with that context)
- SKIP

Adjust flow:
User taps Adjust → types what's wrong → app regenerates using full context + correction.

Replaces current Revise/Discuss pattern with a cleaner, faster loop.

---

## CONFLICT DETECTION

SCOPE CONFLICT (two options defining same parameter differently):
Remove earlier option. Add new. Show: "Updated to [new]."

ARCHITECTURE CONFLICT (two incompatible approaches):
Grey out remaining incompatible options. Tooltip: "Not compatible with your previous selection."

SIMPLICITY CONFLICT (complex option + redundant simpler one):
Keep both. Note: "These overlap — you probably only need one."

Never block. Never error. Always resolve quietly.

---

## INDUSTRY COACHING DEPTH

CONSTRUCTION (deep):
Knows: RFI workflow, submittal process, CO entitlement, Division structure, trade sequences, GC/Sub relationships, AIA contracts, lien rights, OSHA, spec sections, MEP coordination.
Tone: Validates expertise, extracts company-specific layer.

LEGAL (deep):
Knows: Contract review, clause types, risk flags, redlining, matter types, privilege, client communication standards.

HEALTHCARE (deep):
Knows: Prior auth, ICD/CPT codes, HIPAA, payer relationships, care coordination, formulary.

FINANCE (standard):
Knows: Invoice processing, expense categorization, reconciliation, approval hierarchies, audit trails.

HR (standard):
Knows: Resume screening, interview workflow, offer letters, onboarding, EEOC basics.

SALES/CRM (standard):
Knows: Lead qualification, pipeline stages, proposal structure, CRM conventions, follow-up workflows.

GENERAL (generic):
Document processor framing. Functional, less precise. Deepens over time with user data.

---

## BLUEPRINT JSON (deployable — Claude Code reads this directly)

{
  "agent_id": "uuid",
  "agent_name": "RFI Analyst",
  "version": "1.0",
  "created_at": "ISO timestamp",
  "industry": "construction",
  "workflow_type": "rfi_triage",
  "agent_class": "document_processor",
  "complexity": "simple",

  "trigger": {
    "type": "manual_upload",
    "accepted_formats": ["pdf", "docx", "jpg", "png"],
    "max_file_size_mb": 25
  },

  "runtime_inputs": [
    {
      "name": "rfi_document",
      "type": "file",
      "required": true
    }
  ],

  "standing_context": [
    {
      "name": "subcontract",
      "category": "contract",
      "retrieval": "semantic_search"
    }
  ],

  "learning_examples": [],

  "output": {
    "format": "structured_memo",
    "template_id": null,
    "fields": [
      {"name": "rfi_number", "source": "extracted"},
      {"name": "rfi_summary", "source": "generated"},
      {"name": "classification", "source": "computed",
       "enum": ["Compensable", "Not Compensable", "Needs Review"]},
      {"name": "confidence_score", "source": "computed"},
      {"name": "response_recommendation", "source": "generated"}
    ]
  },

  "human_gates": [
    {
      "trigger": "confidence_below_threshold",
      "threshold": 0.80,
      "action": "pause_and_notify"
    }
  ],

  "system_prompt": {
    "role": "You are an expert construction claims analyst with deep knowledge of subcontract terms and RFI response best practices.",
    "constraints": [
      "Cite specific contract section when classifying scope",
      "Flag for attorney review when legal advice would be required",
      "Maintain consistent classification thresholds"
    ],
    "output_format": "All fields required. If confidence below threshold, include reason."
  },

  "failure_handling": {
    "unreadable_document": "pause_and_notify",
    "missing_required_field": "flag_and_continue",
    "low_confidence": "include_score_and_flag",
    "standing_context_not_found": "proceed_with_caveat"
  },

  "observability": {
    "log_every_run": true,
    "log_fields": ["input_hash", "classification", "confidence", "duration_ms", "token_cost", "human_gate_triggered"],
    "alert_on": ["failure_rate_above_20_percent", "cost_spike_2x_baseline", "no_runs_in_7_days"]
  },

  "pricing": {
    "free_runs": 1,
    "subscription_required_after": 1,
    "plan": "hosted_199"
  },

  "deployment": {
    "infrastructure": "railway",
    "runtime": "python_3.11",
    "framework": "anthropic_sdk",
    "entry_point": "agent.py",
    "environment_vars": ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"]
  }
}

---

# PART 4 — TECHNICAL ARCHITECTURE

---

## DATABASE SCHEMA

users: id, email, stripe_customer_id, plan, created_at

agents: id, user_id, name, blueprint_json, industry, workflow_type, complexity,
        status (building|deployed|paused|failed), deployment_url, created_at, deployed_at

agent_documents: id, agent_id, file_name, file_path, category, encoding_type, description, uploaded_at
  category options: contract|spec|drawing|template|sop|approved_list|code|example
  encoding_type options: semantic_search|direct_inject|few_shot

agent_document_chunks: id, document_id, agent_id, chunk_text, embedding vector(1536), chunk_index, created_at
  INDEX: ivfflat (embedding vector_cosine_ops) WITH (lists = 100)

agent_rules: id, agent_id, rule_plain_english, encoding_type, encoded_value, source, active, created_at
  source options: user_defined|distilled_from_failure

agent_lookup_tables: id, agent_id, table_name, key, value, category, created_at

agent_runs: id, agent_id, user_id, input_hash, input_metadata jsonb, output_summary,
            output_path, classification, confidence_score, human_gate_triggered,
            failure_type, failure_detail, duration_ms, token_cost, model_used,
            is_free_run, created_at

agent_suggestions: id, agent_id, failure_pattern, suggestion_plain_english,
                   encoding_type, encoded_fix, impact_estimate, status, created_at
  status options: pending|applied|dismissed

agent_subscriptions: id, user_id, agent_id, stripe_subscription_id, plan, status,
                     current_period_end, created_at

---

## DEPLOYMENT HANDOFF

Claude Code system prompt:
"Build a production AI agent from this blueprint. Implement exactly as specified.

BUILD SEQUENCE:
1. Supabase state schema for this agent's runs
2. Document ingestion: chunk + embed all standing_context with pgvector
3. Core agent loop: perceive → retrieve → decide → act → observe
4. Tool contracts: one function per external action, idempotent
5. System prompt from blueprint.system_prompt
6. Human gate handlers from blueprint.human_gates
7. Failure handlers from blueprint.failure_handling
8. Output formatter from blueprint.output
9. Observability: log all fields in blueprint.observability.log_fields
10. Entry point: agent.py accepting trigger and running the full loop

CONSTRAINTS:
Python 3.11 + Anthropic SDK only.
All state persisted to Supabase before returning.
All runs logged to agent_runs table.
Human gates = async pauses with webhook callback.
No hardcoded secrets. All from environment variables.
Every function has error handling. No silent failures.
Retry transient failures 3 times before logging and notifying."

Output:
/agent_[uuid]/
  agent.py, state.py, tools.py, retrieval.py, formatter.py,
  gates.py, failures.py, logger.py, requirements.txt, Dockerfile,
  README.md (plain English — what this agent does and how to use it)

Hosting: Railway Docker container, isolated per agent.
Endpoint: https://agents.agentacademy.app/[agent_uuid]/run

---

## PRICING TRIGGER

FREE_RUN_LIMIT = environment variable, default 1
Change from 1 to 5 or 10 during testing without redeploying.

if free_runs_used < FREE_RUN_LIMIT: authorized, free
elif active subscription: authorized, billed
else: blocked → conversion screen:
  "Your first run showed what this agent can do.
   Subscribe to keep it running. $199/month."

---

## REVISION AND REDEPLOY LOOP

User requests change
  → Change classified: document|rule|gate|template|example
  → Change encoded appropriately:
      document → re-chunk → re-embed → update pgvector
      rule → update agent_rules → rebuild system prompt
      gate → update blueprint.human_gates → redeploy
      template → update output formatter → redeploy
      example → update few-shot block
  → Agent redeploys (under 60 seconds)
  → Next run uses updated agent
  → Performance compared to pre-change baseline
  → Dashboard: "Change applied — monitoring impact"

---

## DASHBOARD SPEC

RUN HISTORY: Every run as a card with expand, download, and "something wrong?" link.

PERFORMANCE PANEL: Total runs, success rate, avg confidence, avg cost, sparkline, most common failure.

IMPROVEMENT QUEUE: Ranked by impact. Each item has plain English explanation + one-click fix.

TEMPLATE MAPPING SESSION: Post-launch LLM chat for precision mapping.
User speaks plain English. LLM updates mapping. Agent incorporates immediately.

REVISION CHAT: Full LLM with access to blueprint + run history.
Diagnoses failures. Suggests specific fixes. User approves. Applied immediately.

STEP EDITOR: Any intake step reopenable from dashboard.
Edit → validate → redeploy → baseline comparison.

---

## BUILD ORDER

NOW:
1. Adaptive intake (minimum viable steps, no fixed count)
2. Industry detection without dropdown
3. Step visibility determined by agent complexity classification
4. Silent routing (standing context, learning examples)
5. Conflict detection
6. Respin button on all suggestions
7. Construction taxonomy for step 6 (7 categories)
8. Learning examples framing for step 7
9. Toggle-based human gates
10. Plain English blueprint review at launch
11. Mandatory but non-blocking sandbox test
12. Blueprint compiles to deployable JSON
13. Sandbox live during build (right panel desktop, bottom sheet mobile)

PHASE 2 (Deploy):
14. Blueprint JSON to Claude Code
15. Claude Code builds agent codebase
16. Docker to Railway
17. Endpoint live, run 1 free, Stripe on run 2

PHASE 3 (Monitor):
18. agent_runs logging
19. Dashboard run history + performance panel
20. Alert system

PHASE 4 (Improve):
21. Failure classification engine
22. Improvement queue generation
23. Revision chat
24. Step editor
25. Template mapping refinement session
26. Redeploy loop with baseline comparison
