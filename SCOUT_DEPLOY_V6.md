SCOUT — DEPLOY SMARTINTAKE V6 NOW
Date: April 13, 2026
Action required: deploy the files below to agent-academy-beryl.vercel.app

I built v6. Do not build it yourself. Deploy what is already in Box.

=== STEP 1: FETCH THE FILES ===

These are already built and in Box folder 376400197719.

File IDs:
SmartIntakeV6_part1.txt   ID: 2195970711784
SmartIntakeV6_part2.txt   ID: 2195975730071

=== STEP 2: ASSEMBLE ===

cat SmartIntakeV6_part1.txt SmartIntakeV6_part2.txt > SmartIntake.jsx

That is the complete component. 1232 lines. Verified clean.

=== STEP 3: PLACE IN PROJECT ===

cp SmartIntake.jsx src/components/SmartIntake.jsx

=== STEP 4: App.jsx — REPLACE CONTENTS WITH EXACTLY THIS ===

import SmartIntake from './components/SmartIntake'
export default function App() {
  return <SmartIntake />
}

Nothing else. SmartIntake is position:fixed and manages its own layout.
Do NOT wrap it in any div, container, or layout component.

=== STEP 5: BUILD AND DEPLOY ===

npm run build
vercel --prod

=== STEP 6: VERIFICATION TEST ===

Test 1 — Simple agent (should be 4 steps: concept, inputs, outputs, name):
Type: "I want an agent that reads invoice PDFs and extracts line items"
Expected: pre-step classifies as simple, shows ~4 steps, no standing_context step

Test 2 — Complex construction agent (should be 5+ steps with standing_context):
Type: "I receive RFIs from contractors and need to analyze them against our contract and specs to determine if they are legitimate change requests and draft a response"
Expected: pre-step classifies as complex, standing_context step appears with 7 categories

Test 3 — Trigger hygiene (critical):
On any step asking what it reads/receives, suggestions must NOT include:
- Email API / Gmail / Outlook
- Procore / project management platforms
- Any OAuth integration
Suggestions MUST be: manual file upload, drag-drop, paste, Box/Google Drive link

=== WHAT IS NEW IN V6 VS V5 ===

1. PRE-STEP: Single opening textarea "What do you want to automate?"
   Claude classifies industry + workflow + complexity before step 1.
   No dropdown. No industry selection.

2. ADAPTIVE STEPS: Simple agents get 4 steps. Complex get up to 6.
   Only shows steps the agent actually needs.

3. SILENT ROUTING: If user mentions contracts/specs/drawings in inputs
   description, standing_context step is automatically added to flow.
   No interruption, no notification.

4. STANDING CONTEXT STEP: 7 expandable category cards for construction.
   Upload buttons per category. "Add later" always available.
   Non-construction gets Claude-generated equivalent categories.

5. SUGGESTION CARDS: Use This / Adjust / Skip
   Adjust opens text field → regenerates with user feedback.
   Replaces old Revise/Discuss pattern.

6. HUMAN GATES: Toggle cards generated from agent context.
   Simple agents skip this step entirely.

7. BLUEPRINT OUTPUT: Deployable JSON spec, not prose.
   Compiles with agent_id, trigger, runtime_inputs, standing_context,
   system_prompt, failure_handling, observability, deployment config.

=== DO NOT ===

- Do not do find-replace on colors (broke the app before)
- Do not rebuild from scratch (use the assembled file)
- Do not wrap SmartIntake in App.jsx
- Do not add a fixed step counter ("Step X of 10")

Send Jonathan: deploy URL + screenshot of pre-step screen + screenshot of step 2.
