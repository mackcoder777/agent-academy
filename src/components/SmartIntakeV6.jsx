// SmartIntake v6 — Agent Academy | April 2026
// Adaptive intake: step count determined by agent complexity
// Core principle: if the answer wouldn't change what the agent does, don't ask.
// Nothing blocks launch except: no concept + no output defined.

import { useState, useRef, useEffect } from "react";

const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#7C3AED", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
  error: "#EF4444", purple: "#7C3AED",
};

const callClaude = async (messages, system, max_tokens) => {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: max_tokens || 600,
      messages,
      ...(system ? { system } : {}),
    }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const d = await res.json();
  return (d.content || []).map(b => b.text || "").join("");
};

const parseJSON = (text) => {
  const s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/[{[][\s\S]*[}\]]/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
};

// ── STEP DEFINITIONS ──────────────────────────────────────────────────────────
// Each step has: key, headline, sub, learnMore, showWhen(classification)
const ALL_STEPS = [
  {
    key: "concept",
    headline: "What should your agent do?",
    sub: "Describe it like you're explaining to a new employee.",
    learnMore: "The clearer you are about what lands on your desk and what you want back, the better it performs.",
    showWhen: () => true, // always
  },
  {
    key: "inputs",
    headline: "What does it read each time you run it?",
    sub: "The new work you hand it each time. Not standing reference material.",
    learnMore: "This is the new work you hand it each time. Everything it always knows about your company lives somewhere else \u2014 we set that up separately.",
    showWhen: () => true, // always
  },
  {
    key: "outputs",
    headline: "What do you want on your desk when it's done?",
    sub: "Be specific about the format and where it goes.",
    learnMore: "The more specific you are, the more consistent it gets.",
    showWhen: () => true, // always
  },
  {
    key: "standing_context",
    headline: "What does it always need access to?",
    sub: "Upload once. Lives in your agent's memory permanently.",
    learnMore: "These are documents your agent references every time it runs \u2014 contracts, specs, standards. Upload now or add later from your dashboard.",
    showWhen: (c) => c.complexity !== "simple" || c.has_standing_context,
  },
  {
    key: "template",
    headline: "Does your agent follow a specific format?",
    sub: "Upload your company template or let us generate one.",
    learnMore: "If you have a template, upload it and we'll map the fields automatically. You can refine the mapping after launch from your dashboard.",
    showWhen: (c) => c.output_is_templated,
  },
  {
    key: "human_gates",
    headline: "When should it check with you before acting?",
    sub: "Toggle the situations where it should stop and wait for your approval.",
    learnMore: "Good agents know their limits. These gates prevent costly mistakes on high-stakes decisions.",
    showWhen: (c) => c.complexity === "complex",
  },
  {
    key: "name",
    headline: "Name your agent.",
    sub: "Pick something your team will recognize.",
    learnMore: "Names make agents feel real. Pick something descriptive.",
    showWhen: () => true, // always last
  },
];

// ── CONSTRUCTION STANDING CONTEXT CATEGORIES ──────────────────────────────────
const CONSTRUCTION_CATEGORIES = [
  { key: "contracts", label: "Contracts & Scope", desc: "Subcontract, prime contract, scope of work", why: "How it knows what's a change vs. what's included." },
  { key: "specifications", label: "Specifications", desc: "Project specs, addenda, bulletins", why: "What materials and methods are required." },
  { key: "drawings", label: "Drawings", desc: "Drawing sets, sheet indexes, ASIs", why: "What was designed vs. what's being requested." },
  { key: "standards", label: "Company Standards", desc: "SOPs, response templates, guidelines", why: "How your company does things." },
  { key: "approved_lists", label: "Approved Lists", desc: "Approved subs, products, vendors", why: "Who and what you work with." },
  { key: "codes", label: "Codes & Regulations", desc: "OSHA, building codes, AHJ requirements", why: "The rules it has to work within." },
  { key: "historical", label: "Historical Reference", desc: "Past RFI logs, past CO decisions", why: "How similar situations were handled before." },
];

// ── HUMAN GATE DEFAULTS ───────────────────────────────────────────────────────
const DEFAULT_GATES = [
  { key: "before_external", label: "Before sending anything externally", default: true },
  { key: "low_confidence", label: "When confidence is below 80%", default: true },
  { key: "missing_field", label: "When a required field can't be filled", default: true },
  { key: "conflicting_docs", label: "When documents contradict each other", default: false },
  { key: "high_value", label: "When dollar amount exceeds threshold", default: false },
];

// ── SUGGESTION COMPONENT ──────────────────────────────────────────────────────
function Suggestion({ text, onUse, onAdjust, onSkip }) {
  const [adjusting, setAdjusting] = useState(false);
  const [adjustText, setAdjustText] = useState("");

  if (adjusting) {
    return (
      <div style={{ background: C.dim, border: "1px solid " + C.accent + "44", borderRadius: "10px", padding: "0.85rem", marginBottom: "0.7rem" }}>
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.4rem" }}>ADJUST SUGGESTION</div>
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.75rem", color: C.muted, marginBottom: "0.5rem", lineHeight: 1.6 }}>Current: "{text}"</div>
        <input
          value={adjustText}
          onChange={e => setAdjustText(e.target.value)}
          placeholder="What should change? e.g. 'also include the project schedule'"
          onKeyDown={e => { if (e.key === "Enter" && adjustText.trim()) { onAdjust(adjustText.trim()); setAdjusting(false); } }}
          style={{ width: "100%", background: C.card, border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem", color: C.text, fontFamily: "'Inter',sans-serif", fontSize: "0.78rem", outline: "none", marginBottom: "0.5rem" }}
        />
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <button onClick={() => { if (adjustText.trim()) { onAdjust(adjustText.trim()); setAdjusting(false); } }}
            style={{ flex: 1, background: C.accent, border: "none", borderRadius: "6px", padding: "0.5rem", color: "#fff", fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", fontWeight: 600, cursor: "pointer" }}>
            Regenerate
          </button>
          <button onClick={() => setAdjusting(false)}
            style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.5rem 0.8rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.dim, border: "1px solid " + C.accent + "33", borderRadius: "10px", overflow: "hidden", marginBottom: "0.7rem" }}>
      <div style={{ background: C.accent + "15", padding: "0.45rem 0.85rem", borderBottom: "1px solid " + C.accent + "22" }}>
        <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.accent, fontWeight: 600, letterSpacing: "0.07em" }}>SUGGESTED FOR YOUR AGENT</span>
      </div>
      <div style={{ padding: "0.75rem 0.85rem" }}>
        <div style={{ fontSize: "0.85rem", color: C.text, lineHeight: 1.7, marginBottom: "0.7rem", fontFamily: "'Inter',sans-serif" }}>{text}</div>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <button onClick={() => onUse(text)}
            style={{ flex: 2, background: C.accent, border: "none", borderRadius: "7px", padding: "0.5rem", color: "#fff", fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", fontWeight: 700, cursor: "pointer" }}>
            Use This
          </button>
          <button onClick={() => setAdjusting(true)}
            style={{ flex: 1, background: "transparent", border: "1px solid " + C.accent + "55", borderRadius: "7px", padding: "0.45rem", color: C.accent, fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", cursor: "pointer" }}>
            Adjust
          </button>
          <button onClick={onSkip}
            style={{ flex: 1, background: "transparent", border: "1px solid " + C.border, borderRadius: "7px", padding: "0.45rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", cursor: "pointer" }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ── STANDING CONTEXT STEP ─────────────────────────────────────────────────────
function StandingContextStep({ categories, selected, onToggle, files }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {categories.map(cat => {
        const isSelected = selected.includes(cat.key);
        return (
          <div key={cat.key}
            onClick={() => onToggle(cat.key)}
            style={{
              background: isSelected ? C.accent + "12" : C.card,
              border: "1px solid " + (isSelected ? C.accent + "55" : C.border),
              borderRadius: "10px", padding: "0.75rem 0.85rem", cursor: "pointer",
              transition: "all 0.15s",
            }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.82rem", fontWeight: 600, color: isSelected ? C.accent : C.text }}>{cat.label}</span>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.7rem", color: isSelected ? C.accent : C.muted }}>{isSelected ? "\u2713" : "+"}</span>
            </div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.68rem", color: C.muted, lineHeight: 1.5 }}>{cat.desc}</div>
            {isSelected && (
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", color: C.accent + "CC", marginTop: "0.3rem", fontStyle: "italic" }}>
                Why: {cat.why}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", color: C.muted, textAlign: "center", marginTop: "0.3rem" }}>
        Select what applies now. You can always add more from your dashboard after launch.
      </div>
    </div>
  );
}

// ── HUMAN GATES STEP ──────────────────────────────────────────────────────────
function HumanGatesStep({ gates, values, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {gates.map(gate => (
        <div key={gate.key}
          onClick={() => onToggle(gate.key)}
          style={{
            display: "flex", alignItems: "center", gap: "0.7rem",
            background: C.card, border: "1px solid " + C.border,
            borderRadius: "8px", padding: "0.7rem 0.85rem", cursor: "pointer",
          }}>
          <div style={{
            width: "36px", height: "20px", borderRadius: "10px",
            background: values[gate.key] ? C.accent : C.dim,
            position: "relative", transition: "background 0.2s", flexShrink: 0,
          }}>
            <div style={{
              width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
              position: "absolute", top: "2px",
              left: values[gate.key] ? "18px" : "2px",
              transition: "left 0.2s",
            }} />
          </div>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.78rem", color: C.text }}>{gate.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function SmartIntake({ onComplete }) {
  // Classification state
  const [phase, setPhase] = useState("classify"); // classify | intake | blueprint
  const [classification, setClassification] = useState(null);
  const [classifying, setClassifying] = useState(false);
  const [conceptInput, setConceptInput] = useState("");

  // Intake state
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [sugLoading, setSugLoading] = useState(false);
  const [showLearnMore, setShowLearnMore] = useState(false);

  // Standing context state
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [contextFiles, setContextFiles] = useState([]);

  // Human gates state
  const [gateValues, setGateValues] = useState(() => {
    const v = {};
    DEFAULT_GATES.forEach(g => { v[g.key] = g.default; });
    return v;
  });

  // Blueprint
  const [blueprint, setBlueprint] = useState(null);
  const [copied, setCopied] = useState(false);

  // Compute active steps from classification
  const activeSteps = classification
    ? ALL_STEPS.filter(s => s.showWhen(classification))
    : ALL_STEPS.filter(s => ["concept", "inputs", "outputs", "name"].includes(s.key));

  const cur = activeSteps[step] || activeSteps[0];
  const val = data[cur.key] || "";
  const isLast = step === activeSteps.length - 1;
  const canProceed = cur.key === "standing_context" || cur.key === "human_gates" || cur.key === "name"
    ? true : val.trim().length > 0;
  const pct = Math.round(((step + 1) / activeSteps.length) * 100);

  // ── CLASSIFY ──────────────────────────────────────────────────────────────
  const classify = async (text) => {
    setClassifying(true);
    try {
      const raw = await callClaude([{
        role: "user",
        content: `Classify this automation goal and return JSON only:
"${text}"

Return exactly this JSON structure:
{"industry":"one of: construction, legal, healthcare, finance, hr_recruiting, sales_crm, customer_support, real_estate, logistics, content_marketing, general_business","workflow_type":"specific workflow name","agent_class":"one of: document_processor, data_transformer, draft_generator, classifier, extractor, monitor","complexity":"one of: simple, medium, complex","required_steps":["concept","inputs","outputs"],"optional_steps":[],"coaching_depth":"one of: deep, standard, generic","clarifying_question":null}

Rules:
- simple = summarize, extract, classify (3 steps)
- medium = structured output, template filling (3-4 steps)
- complex = multi-doc, cross-reference, judgment calls (4-5 steps)
- If user mentions contracts/specs/drawings/SOPs add "standing_context" to required_steps
- If output sounds templated add "template" to required_steps
- If complex, add "human_gates" to required_steps
- "name" is always the last required step
- NEVER suggest email API, OAuth, or platform integrations`
      }], "", 500);
      const parsed = parseJSON(raw);
      if (parsed) {
        // Enrich classification with derived flags
        parsed.has_standing_context = (parsed.required_steps || []).includes("standing_context");
        parsed.output_is_templated = (parsed.required_steps || []).includes("template");
        setClassification(parsed);
        setData(prev => ({ ...prev, concept: text }));
        setPhase("intake");
        // Start generating suggestion for the next step (inputs)
        generateSuggestion("inputs", text, parsed);
      }
    } catch (e) {
      console.error("Classification failed:", e);
      // Fallback: medium complexity, show all main steps
      const fallback = {
        industry: "general_business", workflow_type: "document_processing",
        agent_class: "document_processor", complexity: "medium",
        required_steps: ["concept", "inputs", "outputs", "name"],
        has_standing_context: false, output_is_templated: false,
      };
      setClassification(fallback);
      setData(prev => ({ ...prev, concept: text }));
      setPhase("intake");
    }
    setClassifying(false);
  };

  // ── GENERATE SUGGESTION ───────────────────────────────────────────────────
  const generateSuggestion = async (stepKey, concept, cls) => {
    setSugLoading(true);
    try {
      const ctx = Object.entries(data).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
      const raw = await callClaude([{
        role: "user",
        content: `You are helping design an AI agent.

Industry: ${(cls || classification)?.industry || "unknown"}
Workflow: ${(cls || classification)?.workflow_type || "unknown"}
Complexity: ${(cls || classification)?.complexity || "medium"}
Agent concept: "${concept || data.concept || ""}"
${ctx ? "\nDefined so far:\n" + ctx : ""}

Generate a specific, production-quality suggestion for: ${stepKey}
${stepKey === "inputs" ? "What runtime inputs does this agent need each time it runs? Be specific to this workflow." : ""}
${stepKey === "outputs" ? "What specific output does this agent produce? Describe the format and content." : ""}
${stepKey === "name" ? "Suggest 3 agent names. Return as JSON: {\"suggestions\": [\"Name 1\", \"Name 2\", \"Name 3\"]}" : ""}

Return a single concise paragraph (2-3 sentences max). No architecture jargon. Phrase as outcomes the user would recognize.
Do NOT mention email APIs, OAuth, platform integrations, or scheduled triggers.`
      }], "", 300);
      setSuggestions(prev => ({ ...prev, [stepKey]: raw.trim() }));
    } catch (e) {
      console.error("Suggestion failed:", e);
    }
    setSugLoading(false);
  };

  // ── ADJUST SUGGESTION ─────────────────────────────────────────────────────
  const adjustSuggestion = async (stepKey, adjustment) => {
    setSugLoading(true);
    try {
      const raw = await callClaude([{
        role: "user",
        content: `Current suggestion for "${stepKey}": "${suggestions[stepKey] || ""}"
User wants this adjusted: "${adjustment}"
Agent concept: "${data.concept || ""}"

Generate an updated suggestion incorporating the adjustment. 2-3 sentences max. Specific to this agent.`
      }], "", 300);
      setSuggestions(prev => ({ ...prev, [stepKey]: raw.trim() }));
    } catch (e) {
      console.error("Adjust failed:", e);
    }
    setSugLoading(false);
  };

  // ── NAVIGATION ────────────────────────────────────────────────────────────
  const goNext = () => {
    if (!canProceed && !isLast) return;
    // Save current step data
    const newData = { ...data, [cur.key]: val };
    if (cur.key === "standing_context") {
      newData.standing_context = selectedCategories.join(", ");
    }
    if (cur.key === "human_gates") {
      newData.human_gates = Object.entries(gateValues)
        .filter(([, v]) => v)
        .map(([k]) => DEFAULT_GATES.find(g => g.key === k)?.label || k)
        .join("; ");
    }
    setData(newData);

    if (isLast) {
      // Build blueprint
      const bp = buildBlueprint(newData);
      setBlueprint(bp);
      setPhase("blueprint");
      if (typeof onComplete === "function") onComplete(newData);
    } else {
      const nextStep = step + 1;
      setStep(nextStep);
      const nextKey = activeSteps[nextStep]?.key;
      if (nextKey && !suggestions[nextKey]) {
        generateSuggestion(nextKey, newData.concept, classification);
      }
      setShowLearnMore(false);
    }
  };

  const goBack = () => {
    setStep(s => Math.max(0, s - 1));
    setShowLearnMore(false);
  };

  // ── BUILD BLUEPRINT ───────────────────────────────────────────────────────
  const buildBlueprint = (d) => {
    return JSON.stringify({
      agent_name: d.name || "My Agent",
      version: "1.0",
      created_at: new Date().toISOString(),
      industry: classification?.industry || "general_business",
      workflow_type: classification?.workflow_type || "document_processing",
      agent_class: classification?.agent_class || "document_processor",
      complexity: classification?.complexity || "medium",
      trigger: { type: "manual_upload", accepted_formats: ["pdf", "docx", "xlsx", "csv", "txt"] },
      concept: d.concept || "",
      runtime_inputs: d.inputs || "",
      standing_context: selectedCategories.map(k => {
        const cat = CONSTRUCTION_CATEGORIES.find(c => c.key === k);
        return { category: cat?.label || k, retrieval: "semantic_search" };
      }),
      output: { description: d.outputs || "", template_id: null },
      human_gates: Object.entries(gateValues).filter(([, v]) => v).map(([k]) => ({
        trigger: k, action: "pause_and_notify",
      })),
      system_prompt: {
        role: `You are an AI agent that ${d.concept || "processes documents"}.`,
        constraints: ["Never fabricate data", "Flag low confidence", "Follow output format exactly"],
        output_format: d.outputs || "structured document",
      },
      failure_handling: {
        unreadable_document: "notify_user",
        missing_required_field: "flag_and_continue",
        low_confidence: "human_gate",
      },
    }, null, 2);
  };

  // ── RENDER: CLASSIFICATION PHASE ──────────────────────────────────────────
  if (phase === "classify") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Inter',sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes fadeup{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} @keyframes spin{to{transform:rotate(360deg)}} .fadein{animation:fadeup 0.3s ease}`}</style>
        <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "16px", width: "100%", maxWidth: "580px", padding: "2.5rem 2rem", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{ fontSize: "0.6rem", color: C.accent, fontWeight: 600, letterSpacing: "0.12em", marginBottom: "0.5rem" }}>AGENT ACADEMY</div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, color: C.text, margin: "0 0 0.5rem", lineHeight: 1.2 }}>What do you want to automate?</h1>
            <p style={{ fontSize: "0.85rem", color: C.muted, lineHeight: 1.6 }}>Describe it in plain English. We'll figure out the rest.</p>
          </div>
          <textarea
            value={conceptInput}
            onChange={e => setConceptInput(e.target.value)}
            placeholder="e.g. Read incoming RFIs and check them against our contract to flag cost impacts..."
            rows={4}
            style={{ width: "100%", background: C.card, border: "1px solid " + C.border, borderRadius: "10px", padding: "0.9rem", color: C.text, fontFamily: "'Inter',sans-serif", fontSize: "0.85rem", lineHeight: 1.7, resize: "none", marginBottom: "1rem" }}
          />
          <button
            onClick={() => { if (conceptInput.trim().length > 10) classify(conceptInput.trim()); }}
            disabled={conceptInput.trim().length < 10 || classifying}
            style={{
              width: "100%", padding: "0.85rem",
              background: (conceptInput.trim().length >= 10 && !classifying) ? C.accent : C.dim,
              border: "none", borderRadius: "10px",
              color: (conceptInput.trim().length >= 10) ? "#fff" : C.muted,
              fontFamily: "'Inter',sans-serif", fontSize: "0.82rem", fontWeight: 700,
              cursor: (conceptInput.trim().length >= 10 && !classifying) ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
            }}>
            {classifying ? (
              <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>{"\\u25CB"}</span> Analyzing your workflow...</>
            ) : "Get Started"}
          </button>
          {conceptInput.trim().length > 0 && conceptInput.trim().length < 10 && (
            <div style={{ fontSize: "0.65rem", color: C.muted, textAlign: "center", marginTop: "0.5rem" }}>
              Keep going \u2014 tell us more about what you want automated.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── RENDER: BLUEPRINT PHASE ───────────────────────────────────────────────
  if (phase === "blueprint" && blueprint) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Inter',sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
        <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "700px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.55rem", color: C.success, fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.15rem" }}>{"\\u2713"} BLUEPRINT COMPLETE</div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.text }}>{data.name || "Your Agent"} is ready to build.</div>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(blueprint); setCopied(true); setTimeout(() => setCopied(false), 2500); }}
              style={{ background: copied ? C.success : C.accent, border: "none", borderRadius: "8px", padding: "0.55rem 1rem", color: "#fff", fontSize: "0.62rem", fontWeight: 700, cursor: "pointer" }}>
              {copied ? "Copied!" : "Copy Blueprint"}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "1.2rem 1.5rem" }}>
            <div style={{ fontSize: "0.52rem", color: C.muted, marginBottom: "0.5rem", letterSpacing: "0.07em" }}>AGENT BLUEPRINT JSON</div>
            <pre style={{ background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", padding: "1rem", fontFamily: "monospace", fontSize: "0.7rem", color: C.cyan, lineHeight: 1.7, whiteSpace: "pre-wrap", margin: "0 0 1rem" }}>
              {blueprint}
            </pre>
            <button onClick={() => { setPhase("classify"); setStep(0); setData({}); setSuggestions({}); setClassification(null); setConceptInput(""); setBlueprint(null); }}
              style={{ width: "100%", background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.6rem", color: C.muted, fontSize: "0.62rem", cursor: "pointer" }}>
              Start over with a different agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: INTAKE PHASE ──────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Inter',sans-serif", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes fadeup{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} @keyframes spin{to{transform:rotate(360deg)}} .fadein{animation:fadeup 0.2s ease} .intake-modal{background:${C.surface};border:1px solid ${C.border};width:100%;max-width:540px;border-radius:16px 16px 0 0;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.4)} @media(min-width:700px){.intake-modal{border-radius:16px;max-width:660px;max-height:88vh;margin-bottom:2rem}} @media(min-width:1100px){.intake-modal{max-width:760px}}`}</style>
      <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
        <div className="intake-modal">
          {/* HEADER */}
          <div style={{ padding: "0.9rem 1.25rem 0.65rem", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ fontSize: "0.52rem", color: C.accent, letterSpacing: "0.1em", fontWeight: 600 }}>
                AGENT ACADEMY {classification?.industry ? "\u2014 " + classification.industry.replace(/_/g, " ").toUpperCase() : ""}
              </span>
              <span style={{ fontSize: "0.52rem", color: C.muted }}>{pct}%</span>
            </div>
            <div style={{ height: "3px", background: C.dim, borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: pct + "%", height: "100%", background: C.accent, transition: "width 0.4s", borderRadius: "2px" }} />
            </div>
          </div>

          {/* BODY */}
          <div className="fadein" style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.25rem 0.5rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.4rem", margin: "0 0 0.2rem", color: C.text, lineHeight: 1.15 }}>{cur.headline}</h2>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "0 0 0.85rem", lineHeight: 1.6 }}>{cur.sub}</p>

            {/* Learn More */}
            {cur.learnMore && (
              <button onClick={() => setShowLearnMore(p => !p)}
                style={{ background: "transparent", border: "none", color: C.accent, fontSize: "0.6rem", cursor: "pointer", padding: 0, marginBottom: "0.6rem", fontFamily: "'Inter',sans-serif" }}>
                {showLearnMore ? "\u25BC Why this matters" : "\u25B6 Why this matters"}
              </button>
            )}
            {showLearnMore && (
              <div className="fadein" style={{ background: C.dim, borderRadius: "8px", padding: "0.65rem 0.85rem", marginBottom: "0.7rem", fontSize: "0.72rem", color: C.muted, lineHeight: 1.6 }}>
                {cur.learnMore}
              </div>
            )}

            {/* SUGGESTION */}
            {sugLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.65rem" }}>
                <span style={{ color: C.accent, display: "inline-block", animation: "spin 1s linear infinite" }}>{"\u25CB"}</span>
                <span style={{ fontSize: "0.6rem", color: C.accent }}>Building a suggestion for your agent...</span>
              </div>
            )}
            {!sugLoading && suggestions[cur.key] && !val && cur.key !== "standing_context" && cur.key !== "human_gates" && (
              <Suggestion
                text={suggestions[cur.key]}
                onUse={(text) => setData(p => ({ ...p, [cur.key]: text }))}
                onAdjust={(adjustment) => adjustSuggestion(cur.key, adjustment)}
                onSkip={() => setSuggestions(p => ({ ...p, [cur.key]: null }))}
              />
            )}

            {/* STEP-SPECIFIC CONTENT */}
            {cur.key === "standing_context" ? (
              <StandingContextStep
                categories={classification?.industry === "construction" ? CONSTRUCTION_CATEGORIES : CONSTRUCTION_CATEGORIES}
                selected={selectedCategories}
                onToggle={(key) => setSelectedCategories(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key])}
                files={contextFiles}
              />
            ) : cur.key === "human_gates" ? (
              <HumanGatesStep
                gates={DEFAULT_GATES}
                values={gateValues}
                onToggle={(key) => setGateValues(p => ({ ...p, [key]: !p[key] }))}
              />
            ) : (
              <textarea
                value={val}
                onChange={e => setData(p => ({ ...p, [cur.key]: e.target.value }))}
                placeholder={cur.key === "name" ? "e.g. RFI Analyzer, Contract Reader, Invoice Processor..." : "Type your answer here..."}
                rows={cur.key === "name" ? 1 : 4}
                style={{
                  width: "100%", background: C.card,
                  border: "1px solid " + (val ? C.accent + "55" : C.border),
                  borderRadius: "10px", padding: "0.85rem",
                  color: C.text, fontFamily: "'Inter',sans-serif", fontSize: "0.82rem",
                  lineHeight: 1.7, resize: "none",
                }}
              />
            )}
          </div>

          {/* FOOTER */}
          <div style={{ padding: "0.7rem 1.25rem 0.9rem", borderTop: "1px solid " + C.border, flexShrink: 0, display: "flex", gap: "0.45rem" }}>
            {step > 0 && (
              <button onClick={goBack}
                style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontSize: "0.62rem", cursor: "pointer" }}>
                Back
              </button>
            )}
            <button onClick={goNext} disabled={!canProceed}
              style={{
                flex: 1, border: "none", borderRadius: "8px", padding: "0.75rem",
                background: canProceed ? C.accent : C.dim,
                color: canProceed ? "#fff" : C.muted,
                fontSize: "0.72rem", fontWeight: 700,
                cursor: canProceed ? "pointer" : "not-allowed",
              }}>
              {isLast ? "Build My Agent" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
