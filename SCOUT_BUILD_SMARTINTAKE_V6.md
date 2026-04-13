SCOUT — BUILD SMARTINTAKE v6
Date: April 13, 2026
Priority: HIGH — this is the full rebuild

=== BOX FOLDER ===
https://app.box.com/folder/376400197719

=== FILE IDs YOU NEED ===

PRODUCT_SPEC.md          ID: 2195807324511  ← READ THIS FIRST — full spec
SPEC_V5_KNOWLEDGE_UPDATE ID: 2195960133460  ← summarized version of spec
SmartIntake_part1.txt    ID: 2195810281364  ← current working SmartIntake (part 1)
SmartIntake_part2.txt    ID: 2195812919585  ← current working SmartIntake (part 2)
PreviewSandbox.txt       ID: 2195817023387  ← sandbox component (rename to .jsx)
DEPLOY_INSTRUCTIONS.txt  ID: 2195809811187  ← App.jsx + deploy steps

=== ASSEMBLE CURRENT SMARTINTAKE ===
cat SmartIntake_part1.txt SmartIntake_part2.txt > SmartIntake.jsx
This is your starting point. It works. Do not break it.

=== WHAT YOU ARE BUILDING ===

SmartIntake v6 — a complete rebuild of the intake flow.

READ PRODUCT_SPEC.md IN FULL BEFORE WRITING ANY CODE.
The spec is the source of truth. Everything below is a summary.

=== CORE PRINCIPLE (do not violate) ===

The intake is adaptive. Step count is determined by what the agent needs.
Simple agents: 3 exchanges. Medium: 3-4. Complex: 5 max.
THE RULE: If the answer wouldn't change what the agent does, don't ask the question.
Nothing blocks launch except: no concept + no output defined.

=== PRE-STEP: INDUSTRY DETECTION ===

Before step 1, show a single opening screen:
"What do you want to automate? Describe it in plain English."

Send to Claude with this classification prompt:
"Classify this automation goal and return JSON only:
{
  'industry': one of [construction, legal, healthcare, finance, hr_recruiting,
    sales_crm, customer_support, real_estate, logistics, content_marketing, general_business],
  'workflow_type': specific workflow (e.g. rfi_triage, invoice_processing),
  'agent_class': one of [document_processor, data_transformer, draft_generator,
    classifier, extractor, monitor],
  'complexity': one of [simple, medium, complex],
  'required_steps': array of step keys needed for this agent,
  'optional_steps': array of step keys that may apply,
  'coaching_depth': one of [deep, standard, generic],
  'clarifying_question': one question if confidence below 0.85, else null
}"

Store classification result in state. Use it throughout the entire intake.
NO DROPDOWN. USER NEVER PICKS AN INDUSTRY.

=== REQUIRED STEPS (show only what classification says is needed) ===

KEY: concept (always)
Headline: "What should your agent do?"
Sub: "Describe it like you're explaining to a new employee."
Coaching: 1-2 gaps max, injectable options phrased as outcomes not architecture.
If description is complete (reads X, produces Y) skip gaps entirely.
Learn More: "The clearer you are about what lands on your desk and what you want back,
the better it performs."

KEY: inputs (always)
Headline: "What does it read each time you run it?"
SILENT ROUTING: if user mentions contracts/specs/SOPs/standards → tag as standing context,
pre-populate step 6 silently, no notification to user.
If user mentions past examples → tag for learning_examples, surface in dashboard after launch.
Learn More: "This is the new work you hand it each time. Everything it always knows
about your company lives somewhere else — we set that up separately."

KEY: outputs (always)
Headline: "What do you want on your desk when it's done?"
Industry-specific options phrased as concrete outcomes.
If output sounds templated → add 'template' to required_steps.
If output is unstructured → skip template step.
Learn More: "The more specific you are, the more consistent it gets."

KEY: standing_context (required for medium/complex, skip for simple unless mentioned)
Headline: "What does it always need access to?"
Sub: "Upload once. Lives in your agent's memory permanently."

For construction, show 7 categories (each with upload button + "add later" option):
1. CONTRACTS AND SCOPE — subcontract, prime contract, scope of work
   Why: "How it knows what's a change vs. what's included."
2. SPECIFICATIONS — project specs, addenda, bulletins
   Why: "What materials and methods are required."
3. DRAWINGS — drawing sets, sheet indexes, ASIs
   Why: "What was designed vs. what's being requested."
4. COMPANY STANDARDS — SOPs, response templates, guidelines
   Why: "How your company does things."
5. APPROVED LISTS — approved subs, products, vendors
   Why: "Who and what you work with."
6. CODES AND REGULATIONS — OSHA, building codes, AHJ
   Why: "The rules it has to work within."
7. HISTORICAL REFERENCE — past RFI logs, past CO decisions
   Why: "How similar situations were handled before."

Non-construction: generate equivalent categories from Claude based on industry.
Multiple selections always enabled. Selecting one never hides others.

KEY: template (only if output is templated)
Headline: "Does your agent follow a specific format?"
Path A — uploads template: best-effort mapping, agent launches, refine in dashboard
Path B — no template: generate one based on industry standard, user accepts/skips
Path C — skip: best-effort output, dashboard queues template upload
NOTHING BLOCKS LAUNCH from this step.

KEY: human_gates (only for complex agents making external/consequential decisions)
Headline: "When should it check with you before acting?"
TOGGLES ONLY — not text fields.
Generate toggle suggestions from Claude based on agent type and what was defined.
Simple agents: skip this step entirely, apply smart defaults silently.

KEY: name (always, always last)
Headline: "Name your agent."
Show suggestions based on workflow type.
Then show plain English blueprint summary.
Then non-blocking sandbox test: upload real file, see output.
"This looks right → Launch" or "One thing is off → fix it (one step back, then launch)"

=== BLUEPRINT OUTPUT ===

On completion, compile to JSON with this structure:
{
  agent_id, agent_name, version, created_at, industry, workflow_type,
  agent_class, complexity,
  trigger: { type, accepted_formats, max_file_size_mb },
  runtime_inputs: [ { name, type, required } ],
  standing_context: [ { name, category, retrieval } ],
  learning_examples: [],
  output: { format, template_id, fields: [ { name, source } ] },
  human_gates: [ { trigger, threshold, action } ],
  system_prompt: { role, constraints, output_format },
  failure_handling: { unreadable_document, missing_required_field, low_confidence,
    standing_context_not_found },
  observability: { log_every_run, log_fields, alert_on },
  pricing: { free_runs, subscription_required_after, plan },
  deployment: { infrastructure, runtime, framework, entry_point, environment_vars }
}

=== SANDBOX ===

Right panel desktop, bottom sheet mobile.
Active from step 2 onwards.
User uploads real file at any point. Agent processes using current partial definition.
Output improves as more steps complete.
Shows: DETECTED / EXTRACTED / ANALYSIS / OUTPUT / WHAT WOULD IMPROVE THIS.
Mobile: bottom sheet slides up on "Test it", slides back when done.

=== CONFLICT DETECTION ===

SCOPE CONFLICT: remove earlier option, add new, show "Updated to [new]"
ARCHITECTURE CONFLICT: grey out incompatible options, tooltip "not compatible"
SIMPLICITY CONFLICT: keep both, note "these overlap — you probably only need one"
Never block. Never error. Always resolve quietly.

=== RESPIN BUTTON ===

Every AI suggestion has three options:
USE THIS / ADJUST (text field → regenerate with context) / SKIP
Replace current Revise/Discuss with this cleaner pattern.

=== SILENT ROUTING RULES ===

In step: inputs
If user text contains: contracts, specifications, specs, drawings, SOPs, standards,
codes, regulations, guidelines, approved list, vendor list, historical, past examples
→ tag silently as standing_context_candidate
→ if standing_context in required_steps: pre-populate that step with tagged items
→ if not in required_steps: queue in dashboard improvement suggestions after launch
→ DO NOT INTERRUPT USER. DO NOT TELL THEM. JUST ROUTE.

=== APP.JSX ===

import SmartIntake from './components/SmartIntake'
export default function App() {
  return <SmartIntake />
}

That is the entire file. SmartIntake is position:fixed and manages its own layout.
Do NOT wrap it in anything.

=== DEPLOY ===

npm run build (confirm zero errors)
vercel --prod
Send URL + screenshot of step 1 and step 2 trigger suggestions

=== VERIFICATION TEST ===

Type: "Build an agent that summarizes construction RFIs"
Expected: 3 steps max (concept + outputs + name)
Trigger step should NOT appear (it's a simple summarizer)
Step 2 should NOT suggest email API or project management systems

Type: "Build an agent that reads RFIs and checks them against our contract"
Expected: 4-5 steps (concept + inputs + standing_context + outputs + name)
Step for standing_context should show construction categories

=== DO NOT ===
- Do not use a fixed step count (no "Step X of 10")
- Do not suggest email API, OAuth, or platform integrations anywhere
- Do not block launch for missing template or standing context
- Do not wrap SmartIntake in App.jsx
- Do not do bulk find-replace on colors (broke the app last time)
