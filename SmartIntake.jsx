// SmartIntake v6 — Adaptive intake, minimum viable steps
// Agent Academy | April 2026
// PART 1 OF 2 — helpers, classification, components
// Combine: cat SmartIntakeV6_part1.txt SmartIntakeV6_part2.txt > SmartIntakeV6.jsx
// Replace src/components/SmartIntake.jsx with SmartIntakeV6.jsx

import { useState, useRef, useEffect } from "react";

const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
};

const callClaude = async (messages, system, max_tokens) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: max_tokens || 800,
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
  const m = s.match(/[\[{][\s\S]*[\]}]/s);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
};

const classifyAgent = async (description, clarifyingAnswer) => {
  const input = clarifyingAnswer
    ? `Goal: "${description}"\nClarification: "${clarifyingAnswer}"`
    : `Goal: "${description}"`;

  const prompt = input + `\n\nClassify and return JSON only — no markdown:
{
  "industry": "construction|legal|healthcare|finance|hr_recruiting|sales_crm|customer_support|real_estate|logistics|content_marketing|general_business",
  "workflow_type": "specific workflow e.g. rfi_triage, invoice_processing, submittal_log",
  "agent_class": "document_processor|data_transformer|draft_generator|classifier|extractor|monitor",
  "complexity": "simple|medium|complex",
  "required_steps": ["concept","inputs","outputs","name"],
  "optional_steps": ["standing_context","template","human_gates"],
  "coaching_depth": "deep|standard|generic",
  "clarifying_question": null,
  "industry_context": "2-3 key domain facts for this specific workflow",
  "output_is_templated": false,
  "needs_standing_context": false,
  "needs_human_gates": false
}

RULES for required_steps:
- Always include: concept, inputs, outputs, name
- Add standing_context if: complexity is medium or complex, OR workflow clearly needs reference docs
- Add template if: output_is_templated is true
- Add human_gates ONLY if: complexity is complex AND agent makes external-facing decisions
- Simple agents (summarize, extract, classify): just concept, inputs, outputs, name — 4 steps max`;

  const raw = await callClaude([{ role: "user", content: prompt }], "", 1000);
  const result = parseJSON(raw);
  if (!result) return null;

  if (!result.required_steps) result.required_steps = ["concept","inputs","outputs","name"];
  ["concept","inputs","outputs"].forEach(s => { if (!result.required_steps.includes(s)) result.required_steps.unshift(s); });
  if (!result.required_steps.includes("name")) result.required_steps.push("name");

  return result;
};

const CONSTRUCTION_CATEGORIES = [
  { key: "contracts", label: "Contracts & Scope", description: "How your agent knows what is included vs. what is a legitimate change.", examples: "Subcontract, prime contract, scope of work", category: "contract" },
  { key: "specifications", label: "Specifications", description: "What materials and methods are required on this project.", examples: "Project specs (relevant divisions), addenda, bulletins", category: "spec" },
  { key: "drawings", label: "Drawings", description: "What was originally designed vs. what is being requested.", examples: "Relevant drawing sets, sheet indexes, ASIs", category: "drawing" },
  { key: "company_standards", label: "Company Standards", description: "How your company does things — your process, your language, your approach.", examples: "SOPs, standard response templates, internal guidelines", category: "sop" },
  { key: "approved_lists", label: "Approved Lists", description: "Who you work with and what you use — flags anything outside your standards.", examples: "Approved subcontractors, approved products, preferred vendors", category: "approved_list" },
  { key: "codes", label: "Codes & Regulations", description: "The rules your agent has to work within.", examples: "Relevant OSHA standards, building codes, local AHJ requirements", category: "code" },
  { key: "historical", label: "Historical Reference", description: "How similar situations were handled before — keeps decisions consistent.", examples: "Past RFI logs, past CO decisions, resolved disputes", category: "example" },
];

const getStandingContextCategories = async (industry, workflowType) => {
  if (industry === "construction") return CONSTRUCTION_CATEGORIES;
  const raw = await callClaude([{ role: "user", content: `For a ${industry} agent handling ${workflowType}, list 4-6 categories of standing reference documents. JSON array only:\n[{"key":"key","label":"Name","description":"one sentence what this enables","examples":"specific files","category":"contract|spec|template|sop|approved_list|code|example"}]` }], "", 500);
  return parseJSON(raw) || [];
};

const STANDING_KEYWORDS = ["contract","subcontract","scope of work","specification","spec","division","addendum","addenda","bulletin","drawing","plans","asis","sop","standard operating","procedure","guideline","boilerplate","approved list","approved product","approved vendor","osha","building code","regulation","ahj","historical","past rfi","past change order","company standard","our standard","internal policy","manual"];

const detectSilentRouting = (text) => {
  const l = text.toLowerCase();
  return {
    hasStandingContext: STANDING_KEYWORDS.some(kw => l.includes(kw)),
    hasLearningExamples: ["past example","previous example","how we handled","our approach","we typically","similar case"].some(kw => l.includes(kw)),
  };
};

const buildContext = (data, classification) => {
  const parts = [];
  if (classification) parts.push(`INDUSTRY: ${classification.industry} | WORKFLOW: ${classification.workflow_type} | COMPLEXITY: ${classification.complexity}`);
  if (classification?.industry_context) parts.push("DOMAIN: " + classification.industry_context);
  if (data.concept) parts.push("WHAT IT DOES: " + data.concept);
  if (data.inputs) parts.push("WHAT IT READS: " + data.inputs);
  if (data.outputs) parts.push("WHAT IT PRODUCES: " + data.outputs);
  if (data.template) parts.push("TEMPLATE: " + data.template);
  if (data.standing_context_summary) parts.push("STANDING CONTEXT: " + data.standing_context_summary);
  return parts.join("\n");
};

const compileBlueprint = (data, classification, standingDocs, humanGates, templateAnalysis) => {
  const enabledGates = (humanGates || []).filter(g => g.enabled);
  return {
    agent_id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(),
    agent_name: data.name || "My Agent",
    version: "1.0",
    created_at: new Date().toISOString(),
    industry: classification?.industry || "general_business",
    workflow_type: classification?.workflow_type || "document_processor",
    agent_class: classification?.agent_class || "document_processor",
    complexity: classification?.complexity || "simple",
    trigger: { type: "manual_upload", accepted_formats: ["pdf","docx","xlsx","jpg","png","txt","csv"], max_file_size_mb: 25 },
    runtime_inputs: [{ name: "input_document", type: "file", required: true, description: data.inputs || "Document provided by user each run" }],
    standing_context: standingDocs.map(doc => ({ name: doc.categoryKey, category: doc.categoryType, file_name: doc.name, retrieval: ["template","sop"].includes(doc.categoryType) ? "direct_inject" : "semantic_search" })),
    learning_examples: [],
    output: {
      format: data.template ? "templated" : "structured",
      template_id: data.template ? "uploaded" : null,
      description: data.outputs,
      fields: templateAnalysis?.fields ? templateAnalysis.fields.map(f => ({ name: f, source: (templateAnalysis.source_document_fields||[]).includes(f) ? "extracted" : (templateAnalysis.computed_fields||[]).includes(f) ? "computed" : "generated" })) : [{ name: "output", source: "generated" }],
    },
    human_gates: enabledGates.map(g => ({ trigger: g.trigger, action: "pause_and_notify", message: g.label, threshold: g.threshold || null })),
    system_prompt: {
      role: `You are an expert ${classification?.industry || "business"} workflow agent specializing in ${classification?.workflow_type || "document processing"}.`,
      constraints: ["Always produce complete, accurate output — never truncate", "When confidence is low, flag it clearly rather than guessing", "Follow the output format exactly as specified", "Use standing context documents as authoritative reference — cite specific sections"],
      output_format: data.template ? "Follow the uploaded template exactly. All fields required." : "Produce structured output matching the described format.",
    },
    failure_handling: { unreadable_document: "pause_and_notify", missing_required_field: "flag_and_continue", low_confidence: "include_score_and_flag", standing_context_not_found: "proceed_with_caveat", api_error: "retry_3_times_then_notify" },
    observability: { log_every_run: true, log_fields: ["input_hash","confidence","duration_ms","token_cost","human_gate_triggered","failure_type"], alert_on: ["failure_rate_above_20_percent","cost_spike_2x_baseline","no_runs_in_7_days"] },
    pricing: { free_runs: 1, subscription_required_after: 1, plan: "hosted_199" },
    deployment: { infrastructure: "railway", runtime: "python_3.11", framework: "anthropic_sdk", entry_point: "agent.py", environment_vars: ["ANTHROPIC_API_KEY","SUPABASE_URL","SUPABASE_KEY"] },
  };
};

const analyzeTemplate = async (file) => {
  const reader = new FileReader();
  const fileContent = await new Promise((resolve, reject) => {
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    if (file.type === "application/pdf") reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
  const prompt = 'Analyze this form an AI agent will fill out. Return JSON only:\n{"fields":["all field names"],"source_document_fields":["auto-extracted from source doc"],"user_provided_fields":["user types manually"],"computed_fields":["agent calculates"],"required_inputs":"what source document does user upload?","summary":"one sentence: what is this form for?"}';
  let messages;
  if (file.type === "application/pdf") {
    const b64 = fileContent.split(",")[1];
    messages = [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: prompt }] }];
  } else {
    messages = [{ role: "user", content: "Form:\n\n" + fileContent.substring(0, 3000) + "\n\n" + prompt }];
  }
  return parseJSON(await callClaude(messages, "", 600));
};

function SuggestionCard({ suggestion, onUse, onSkip, stepKey }) {
  const [adjusting, setAdjusting] = useState(false);
  const [adjustInput, setAdjustInput] = useState("");
  const [respinning, setRespinning] = useState(false);
  const handleAdjust = async () => {
    if (!adjustInput.trim()) return;
    setRespinning(true);
    try {
      const raw = await callClaude([{ role: "user", content: `Original suggestion for "${stepKey}": "${suggestion}"\n\nUser feedback: "${adjustInput}"\n\nGenerate an improved suggestion. 2-3 sentences max. Plain text only.` }], "", 300);
      onUse(raw.trim());
    } catch {}
    setRespinning(false); setAdjusting(false); setAdjustInput("");
  };
  return (
    <div style={{ background: "#0E1A26", border: "1px solid " + C.gold + "55", borderRadius: "10px", overflow: "hidden", marginBottom: "0.75rem" }}>
      <div style={{ background: C.gold + "18", padding: "0.45rem 0.85rem", borderBottom: "1px solid " + C.gold + "33" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>SUGGESTED FOR YOUR AGENT</span>
      </div>
      <div style={{ padding: "0.75rem 0.85rem 0.65rem" }}>
        <div style={{ fontSize: "0.83rem", color: C.text, lineHeight: 1.7, marginBottom: "0.65rem" }}>{suggestion}</div>
        {adjusting ? (
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginBottom: "0.3rem" }}>What should be different?</div>
            <input value={adjustInput} onChange={e => setAdjustInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && adjustInput.trim()) handleAdjust(); }}
              placeholder="e.g. we use Box, not Google Drive"
              style={{ width: "100%", background: C.code, border: "1px solid " + C.gold + "44", borderRadius: "5px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "monospace", fontSize: "0.62rem", outline: "none", marginBottom: "0.4rem" }} />
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button onClick={handleAdjust} disabled={!adjustInput.trim() || respinning}
                style={{ flex: 1, background: respinning ? C.dim : C.gold, border: "none", borderRadius: "5px", padding: "0.38rem", color: respinning ? C.muted : "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: adjustInput.trim() && !respinning ? "pointer" : "not-allowed" }}>
                {respinning ? "Generating..." : "Regenerate →"}
              </button>
              <button onClick={() => { setAdjusting(false); setAdjustInput(""); }} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.38rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.35rem" }}>
            <button onClick={() => onUse(suggestion)} style={{ background: "linear-gradient(135deg," + C.gold + ",#D97706)", border: "none", borderRadius: "7px", padding: "0.5rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>Use This</button>
            <button onClick={() => setAdjusting(true)} style={{ background: "transparent", border: "1px solid " + C.gold + "55", borderRadius: "7px", padding: "0.45rem", color: C.gold, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>Adjust</button>
            <button onClick={onSkip} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "7px", padding: "0.45rem", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>Skip</button>
          </div>
        )}
      </div>
    </div>
  );
}

function HintCard({ hint, index, addedOptions, onInject, onUndo, onDiscuss }) {
  const added = addedOptions || [];
  const remaining = (hint.options || []).filter(o => !added.includes(o));
  return (
    <div style={{ background: added.length > 0 ? C.success + "08" : "#0D1B27", border: "1px solid " + (added.length > 0 ? C.success + "33" : "#1D3246"), borderRadius: "8px", padding: "0.65rem 0.75rem", marginBottom: "0.4rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <span style={{ color: added.length > 0 ? C.success : C.accent, flexShrink: 0, fontSize: "0.65rem", marginTop: "2px" }}>{added.length > 0 ? "+" : "→"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.8rem", color: "#D0E4EE", lineHeight: 1.6, marginBottom: "0.4rem" }}>{hint.gap}</div>
          {added.length > 0 && (
            <div style={{ marginBottom: "0.35rem" }}>
              {added.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.15rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success }}>+ "{a}"</span>
                  <button onClick={() => onUndo(index, a)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.48rem" }}>undo</button>
                </div>
              ))}
            </div>
          )}
          {remaining.length > 0 && (
            <div style={{ marginBottom: "0.3rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.cyan, marginBottom: "0.2rem", letterSpacing: "0.06em" }}>{added.length > 0 ? "ADD MORE:" : "PICK A SOLUTION:"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.18rem" }}>
                {remaining.map((opt, oi) => (
                  <button key={oi} onClick={() => onInject(index, opt)}
                    style={{ background: "#0A1E2E", border: "1px solid " + C.cyan + "44", borderRadius: "6px", padding: "0.38rem 0.6rem", color: "#A0D4E8", fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", textAlign: "left", lineHeight: 1.5 }}
                    onMouseOver={e => e.currentTarget.style.background = "#0F2A3E"} onMouseOut={e => e.currentTarget.style.background = "#0A1E2E"}>
                    + {opt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {added.length === 0 && (
            <button onClick={() => onDiscuss(hint.gap)} style={{ background: "transparent", border: "1px solid #1D3246", borderRadius: "5px", padding: "0.28rem 0.6rem", color: "#7090A8", fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer" }}>Discuss</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBox({ open, onToggle, history, onSend, loading }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);
  if (!open) {
    return (
      <button onClick={onToggle} style={{ width: "100%", background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.5rem 0.8rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: C.cyan }}>?</span><span>Not sure what this means? Ask me anything.</span>
      </button>
    );
  }
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: C.dim, padding: "0.38rem 0.65rem", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted }}>Assistant — knows your agent</span>
        <button onClick={onToggle} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "0.9rem" }}>×</button>
      </div>
      <div style={{ maxHeight: "160px", overflowY: "auto", padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {history.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ background: m.role === "user" ? C.accent : C.dim, color: m.role === "user" ? "#000" : C.text, borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", padding: "0.4rem 0.55rem", fontFamily: "monospace", fontSize: "0.62rem", lineHeight: 1.55, maxWidth: "88%" }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ display: "flex" }}><div style={{ background: C.dim, borderRadius: "10px 10px 10px 2px", padding: "0.4rem 0.55rem", fontFamily: "monospace", fontSize: "0.58rem", color: C.muted }}>Thinking...</div></div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "0.35rem 0.45rem", borderTop: "1px solid " + C.border, display: "flex", gap: "0.28rem" }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && input.trim()) { onSend(input.trim()); setInput(""); } }} placeholder="Ask anything..."
          style={{ flex: 1, background: C.bg, border: "1px solid " + C.dim, borderRadius: "6px", padding: "0.35rem 0.48rem", color: C.text, fontFamily: "monospace", fontSize: "0.62rem", outline: "none" }} />
        <button onClick={() => { if (input.trim()) { onSend(input.trim()); setInput(""); } }} disabled={!input.trim() || loading}
          style={{ background: input.trim() ? C.accent : C.dim, border: "none", borderRadius: "6px", padding: "0.35rem 0.6rem", color: input.trim() ? "#000" : C.muted, fontFamily: "monospace", fontWeight: 700, cursor: input.trim() ? "pointer" : "not-allowed" }}>→</button>
      </div>
    </div>
  );
}

function StandingContextStep({ classification, standingDocs, setStandingDocs }) {
  const [categories, setCategories] = useState(null);
  const [loadingCats, setLoadingCats] = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (classification?.industry === "construction") { setCategories(CONSTRUCTION_CATEGORIES); return; }
    setLoadingCats(true);
    getStandingContextCategories(classification?.industry, classification?.workflow_type)
      .then(cats => { setCategories(cats); setLoadingCats(false); })
      .catch(() => setLoadingCats(false));
  }, []);

  if (loadingCats) return <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1rem 0" }}><span style={{ color: C.cyan }}>◌</span><span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.cyan }}>Preparing categories...</span></div>;
  if (!categories) return null;

  const getDocsForCat = (key) => standingDocs.filter(d => d.categoryKey === key);
  const toggleExpand = (key) => setExpanded(e => ({ ...e, [key]: !e[key] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {categories.map(cat => {
        const docs = getDocsForCat(cat.key);
        const isOpen = expanded[cat.key];
        const fileInputId = "sc_" + cat.key;
        return (
          <div key={cat.key} style={{ background: docs.length > 0 ? C.success + "08" : "#0A141E", border: "1px solid " + (docs.length > 0 ? C.success + "33" : C.border), borderRadius: "8px", overflow: "hidden" }}>
            <div onClick={() => toggleExpand(cat.key)} style={{ padding: "0.6rem 0.8rem", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.12rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: docs.length > 0 ? C.success : C.text, fontWeight: 600 }}>{cat.label}</span>
                  {docs.length > 0 && <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.success, background: C.success + "22", padding: "0.06rem 0.3rem", borderRadius: "3px" }}>{docs.length} uploaded</span>}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.54rem", color: C.muted, lineHeight: 1.5 }}>{cat.description}</div>
              </div>
              <span style={{ color: C.muted, fontSize: "0.65rem", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "0 0.8rem 0.6rem", borderTop: "1px solid " + C.border }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, margin: "0.4rem 0", lineHeight: 1.5 }}>Examples: {cat.examples}</div>
                {docs.map((doc, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.22rem", background: C.code, borderRadius: "5px", padding: "0.32rem 0.5rem" }}>
                    <span style={{ color: C.success, fontSize: "0.58rem" }}>✓</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.57rem", color: C.text, flex: 1 }}>{doc.name}</span>
                    <button onClick={() => setStandingDocs(p => p.filter(d => !(d.categoryKey === cat.key && d.name === doc.name)))} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "0.65rem" }}>×</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: "0.38rem", marginTop: "0.35rem" }}>
                  <label style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.4rem", background: C.dim, border: "1px dashed " + C.cyan + "44", borderRadius: "6px", padding: "0.42rem 0.6rem", cursor: "pointer" }}>
                    <span style={{ color: C.cyan }}>+</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.56rem", color: C.muted }}>Upload {cat.label.toLowerCase()}</span>
                    <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt" style={{ display: "none" }}
                      onChange={e => { if (e.target.files[0]) setStandingDocs(p => [...p, { categoryKey: cat.key, categoryType: cat.category, name: e.target.files[0].name, file: e.target.files[0] }]); }} />
                  </label>
                  <button onClick={() => toggleExpand(cat.key)} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.42rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.54rem", cursor: "pointer" }}>Add later</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, lineHeight: 1.55, paddingTop: "0.25rem" }}>Everything uploaded here lives permanently in your agent's library — available on every run automatically.</div>
    </div>
  );
}

function HumanGatesStep({ classification, data, humanGates, setHumanGates }) {
  const [loading, setLoading] = useState(humanGates.length === 0);

  useEffect(() => {
    if (humanGates.length > 0) return;
    const ctx = buildContext(data, classification);
    callClaude([{ role: "user", content: ctx + "\n\nGenerate 2-4 human oversight gates for this agent. Return JSON array:\n[{\"trigger\":\"trigger_key\",\"label\":\"Plain English: when this happens\",\"description\":\"Why be in the loop here\",\"enabled\":true,\"threshold\":null}]\n\nOnly include gates relevant to this agent. Simple document analysis agents: 1-2 gates max. Keep it minimal." }], "", 500)
      .then(raw => {
        const gates = parseJSON(raw);
        if (Array.isArray(gates) && gates.length > 0) setHumanGates(gates);
        else setHumanGates([
          { trigger: "before_saving", label: "Before the output is saved or delivered", description: "Review the output before it goes anywhere.", enabled: true, threshold: null },
          { trigger: "low_confidence", label: "When it is not sure about something", description: "Flag when confidence drops below 80%.", enabled: true, threshold: 0.80 },
        ]);
      })
      .catch(() => setHumanGates([{ trigger: "before_saving", label: "Before the output is saved", description: "Review before saving.", enabled: true, threshold: null }]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (i) => setHumanGates(prev => prev.map((g, idx) => idx === i ? { ...g, enabled: !g.enabled } : g));

  if (loading) return <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1rem 0" }}><span style={{ color: C.gold }}>◌</span><span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.gold }}>Generating oversight suggestions...</span></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
      {humanGates.map((gate, i) => (
        <div key={i} style={{ background: gate.enabled ? C.success + "08" : C.dim, border: "1px solid " + (gate.enabled ? C.success + "33" : C.border), borderRadius: "8px", padding: "0.6rem 0.75rem", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
          <div style={{ flexShrink: 0, marginTop: "1px" }}>
            <div onClick={() => toggle(i)} style={{ width: "34px", height: "18px", background: gate.enabled ? C.success : "#2A3A4A", borderRadius: "9px", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
              <div style={{ position: "absolute", top: "2px", left: gate.enabled ? "16px" : "2px", width: "14px", height: "14px", background: "#fff", borderRadius: "50%", transition: "left 0.2s" }} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: gate.enabled ? C.text : C.muted, fontWeight: 600, marginBottom: "0.12rem" }}>{gate.label}</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, lineHeight: 1.5 }}>{gate.description}</div>
          </div>
        </div>
      ))}
      <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, lineHeight: 1.55, marginTop: "0.15rem" }}>Adjust these anytime from your dashboard. Your agent pauses and notifies you when a gate triggers.</div>
    </div>
  );
}
// SmartIntake v6 — PART 2 OF 2 — Main SmartIntake component
// Combine: cat SmartIntakeV6_part1.txt SmartIntakeV6_part2.txt > SmartIntakeV6.jsx

export default function SmartIntake({ onComplete }) {
  const [phase, setPhase] = useState("pre_step");
  const [preStepText, setPreStepText] = useState("");
  const [classification, setClassification] = useState(null);
  const [clarifyingAnswer, setClarifyingAnswer] = useState("");
  const [classifyError, setClassifyError] = useState("");

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [data, setData] = useState({});
  const [standingDocs, setStandingDocs] = useState([]);
  const [humanGates, setHumanGates] = useState([]);
  const [templateFile, setTemplateFile] = useState(null);
  const [templateAnalysis, setTemplateAnalysis] = useState(null);
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);

  const [suggestion, setSuggestion] = useState("");
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [hints, setHints] = useState([]);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [addedOptions, setAddedOptions] = useState({});
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSolution, setChatSolution] = useState("");
  const [learnMore, setLearnMore] = useState(false);
  const [blueprint, setBlueprint] = useState(null);
  const [bpCopied, setBpCopied] = useState(false);
  const [silentRoutingDone, setSilentRoutingDone] = useState(false);

  const coachTimer = useRef(null);
  const skipNextCoach = useRef(false);
  const templateFileRef = useRef(null);

  const requiredSteps = classification?.required_steps || [];
  const currentStepKey = requiredSteps[currentStepIndex];
  const isLastStep = currentStepIndex === requiredSteps.length - 1;
  const val = data[currentStepKey] || "";

  const STEP_CONFIG = {
    concept: {
      headline: "What should your agent do?",
      sub: "Describe it like you are explaining to a new employee — what does it handle and what do you want back?",
      placeholder: "e.g. Read incoming RFI documents and produce a one-page analysis with risk rating and recommended response...",
      learnMoreText: "The clearer you are about what lands on your desk and what you want back, the better your agent performs. You can always refine this later.",
      optional: false, noCoach: false,
    },
    inputs: {
      headline: "What does it read each time you run it?",
      sub: "Every time you hand your agent work, what does it need to look at?",
      placeholder: "e.g. The RFI document — uploaded as a PDF or Word file...",
      learnMoreText: "This is the new work you hand it each time. Everything your agent always knows about your company is stored separately and available automatically.",
      optional: false, noCoach: false,
    },
    outputs: {
      headline: "What do you want on your desk when it is done?",
      sub: "When your agent finishes, what should exist that did not before?",
      placeholder: "e.g. A one-page memo with RFI summary, risk classification, and a draft response...",
      learnMoreText: "The more specific you are, the more consistent it gets. A summary varies every time. A one-page memo with risk rating and recommended response is the same every time.",
      optional: false, noCoach: false,
    },
    standing_context: {
      headline: "What does it always need access to?",
      sub: "Upload once. Lives in your agent permanently. You never think about it again.",
      learnMoreText: "This is everything your agent needs to know about your company and this project — your contracts, your specs, your standards. It checks these on every run automatically.",
      optional: true, noCoach: true,
    },
    template: {
      headline: "Does your agent follow a specific format?",
      sub: "Upload your template and your agent will follow your exact structure every time.",
      learnMoreText: "A template is your agent style guide. Without one it makes format decisions every time. With one, every output looks exactly how your company presents this work.",
      optional: true, noCoach: true,
    },
    human_gates: {
      headline: "When should it stop and check with you?",
      sub: "Your agent handles routine work automatically. These are the moments where it pauses.",
      learnMoreText: "Human gates are the moments your agent knows to stop and get you. A well-designed agent handles routine work automatically and brings you in for judgment calls.",
      optional: true, noCoach: true,
    },
    name: {
      headline: "Name your agent.",
      sub: "What do you want to call it? Your team will see this name in your dashboard.",
      placeholder: "e.g. RFI Analyst, Invoice Reader, Submittal Scout...",
      learnMoreText: "Names make agents feel real and help your team know what each one does.",
      optional: false, noCoach: true,
    },
  };

  const curConfig = STEP_CONFIG[currentStepKey] || {};
  const canProceed = ["standing_context","human_gates","template"].includes(currentStepKey) ? true : (curConfig.optional ? true : val.trim().length > 0);
  const pct = requiredSteps.length > 1 ? Math.round((currentStepIndex / (requiredSteps.length - 1)) * 100) : 100;

  const handlePreStepSubmit = async () => {
    if (!preStepText.trim()) return;
    setPhase("classifying"); setClassifyError("");
    try {
      const result = await classifyAgent(preStepText, "");
      if (!result) throw new Error("failed");
      setClassification(result);
      if (result.clarifying_question) { setPhase("clarifying"); }
      else { setData(d => ({ ...d, concept: preStepText })); setPhase("steps"); setCurrentStepIndex(0); }
    } catch { setClassifyError("Something went wrong. Please try again."); setPhase("pre_step"); }
  };

  const handleClarifyingSubmit = async () => {
    if (!clarifyingAnswer.trim()) return;
    setPhase("classifying");
    try {
      const result = await classifyAgent(preStepText, clarifyingAnswer);
      if (!result) throw new Error("failed");
      result.clarifying_question = null;
      setClassification(result);
      setData(d => ({ ...d, concept: preStepText + ". " + clarifyingAnswer }));
      setPhase("steps"); setCurrentStepIndex(0);
    } catch { setClassifyError("Something went wrong."); setPhase("pre_step"); }
  };

  useEffect(() => {
    if (!classification || !currentStepKey) return;
    if (curConfig.noCoach) return;
    setSuggestion(""); setHints([]); setHintsLoading(false);
    setAddedOptions({}); setChatOpen(false); setChatHistory([]); setChatSolution(""); setLearnMore(false);
    generateStepSuggestion();
  }, [currentStepIndex, currentStepKey]);

  const generateStepSuggestion = async () => {
    if (!classification || curConfig.noCoach || currentStepKey === "name") return;
    setSuggestionLoading(true);
    try {
      const ctx = buildContext(data, classification);
      const raw = await callClaude([{ role: "user", content: ctx + "\n\nFor the step: \"" + (curConfig.headline || currentStepKey) + "\"\n\nGenerate a specific, concrete suggestion for this agent.\n\nCRITICAL: Plain English only. For trigger/inputs: ONLY manual file upload, drag-drop, paste, or Box/Google Drive. NO email API, NO OAuth, NO platform integrations. 2-3 sentences max.\n\nPlain text only — no JSON." }], "", 300);
      if (raw?.trim()?.length > 10) setSuggestion(raw.trim());
    } catch {}
    setSuggestionLoading(false);
  };

  useEffect(() => {
    if (curConfig.noCoach || val.trim().length < 25) { setHints([]); return; }
    if (skipNextCoach.current) { skipNextCoach.current = false; return; }
    clearTimeout(coachTimer.current);
    coachTimer.current = setTimeout(async () => {
      setHintsLoading(true);
      try {
        const ctx = buildContext(data, classification);
        const raw = await callClaude([{ role: "user", content: ctx + "\n\nAnswer for \"" + (curConfig.headline || currentStepKey) + "\": \"" + val + "\"\n\nIdentify 0-2 gaps that would change what the agent does. For triggers: only manual upload/paste/Box/Drive options.\n\nJSON array (empty if complete):\n[{\"gap\":\"what is missing\",\"options\":[\"A\",\"B\",\"C\"]}]" }], "", 400);
        const parsed = parseJSON(raw);
        if (Array.isArray(parsed)) setHints(parsed.slice(0,2).map(h => typeof h === "string" ? {gap:h,options:[]} : {gap:h.gap||"",options:h.options||[]}).filter(h=>h.gap));
        else setHints([]);
      } catch { setHints([]); }
      setHintsLoading(false);
    }, 1200);
    return () => clearTimeout(coachTimer.current);
  }, [val, currentStepKey]);

  useEffect(() => {
    if (currentStepKey !== "inputs" || silentRoutingDone || val.trim().length < 30) return;
    const { hasStandingContext } = detectSilentRouting(val);
    if (hasStandingContext && !requiredSteps.includes("standing_context")) {
      const updated = [...requiredSteps];
      const nameIdx = updated.indexOf("name");
      updated.splice(nameIdx, 0, "standing_context");
      setClassification(prev => ({ ...prev, required_steps: updated }));
    }
    setSilentRoutingDone(true);
  }, [val, currentStepKey]);

  const goNext = () => {
    if (!canProceed) return;
    const newData = { ...data, [currentStepKey]: val };
    if (currentStepKey === "standing_context" && standingDocs.length > 0) newData.standing_context_summary = standingDocs.map(d => d.label + ": " + d.name).join(", ");
    if (currentStepKey === "human_gates") newData.human_gates_summary = humanGates.filter(g=>g.enabled).map(g=>g.label).join("; ");
    setData(newData); skipNextCoach.current = true;

    if (isLastStep) {
      const bp = compileBlueprint(newData, classification, standingDocs, humanGates, templateAnalysis);
      setBlueprint(bp); setPhase("blueprint");
      if (typeof onComplete === "function") onComplete({ agentName: newData.name || "My Agent", concept: newData.concept, triggers: newData.inputs, inputs: newData.inputs, outputs: newData.outputs, template: newData.template, templateAnalysis, standingDocs, humanGates: humanGates.filter(g=>g.enabled), rag: newData.standing_context_summary, constraints: newData.human_gates_summary, blueprint: bp });
    } else {
      setCurrentStepIndex(i => i + 1); setSilentRoutingDone(false);
    }
  };

  const goBack = () => { if (currentStepIndex > 0) setCurrentStepIndex(i => i - 1); };

  const handleInject = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [currentStepKey]: (p[currentStepKey]||"").trimEnd() + (p[currentStepKey] ? ", " : "") + option }));
    setAddedOptions(p => ({ ...p, [index]: [...(p[index]||[]), option] }));
  };
  const handleUndo = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [currentStepKey]: (p[currentStepKey]||"").replace(", "+option,"").replace(option+", ","").replace(option,"").trim() }));
    setAddedOptions(p => ({ ...p, [index]: (p[index]||[]).filter(o=>o!==option) }));
  };

  const handleChatSend = async (msg) => {
    setChatLoading(true);
    const hist = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(hist);
    try {
      const ctx = buildContext(data, classification);
      const r = await callClaude(hist, "You help design AI agents. Context:\n" + ctx + "\n\nStep: \"" + (curConfig.headline||currentStepKey) + "\"\n\nRules:\n1. Stay on current step\n2. Plain English, no jargon\n3. No email API, OAuth, or platform integrations — only manual upload/paste/Box/Drive\n4. Under 80 words\n5. Conclude with: SOLUTION: [one sentence]", 200);
      const sol = r.match(/SOLUTION:\s*(.+?)(?:\n|$)/i);
      if (sol) { setChatSolution(sol[1].trim()); setChatHistory([...hist, { role: "assistant", content: r.replace(/SOLUTION:\s*.+?(?:\n|$)/i,"").trim() }]); }
      else { setChatSolution(""); setChatHistory([...hist, { role: "assistant", content: r }]); }
    } catch { setChatHistory([...hist, { role: "assistant", content: "Connection issue, try again." }]); }
    setChatLoading(false);
  };

  // ── PRE-STEP ────────────────────────────────────────────────

  if (phase === "pre_step" || phase === "classifying") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem", fontFamily: "'Syne', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}} .fade{animation:fadeup 0.3s ease}`}</style>
        <div className="fade" style={{ background: "#0B0F16", border: "1px solid #182430", borderRadius: "14px", width: "100%", maxWidth: "600px", padding: "2rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: "#F97316", letterSpacing: "0.12em", marginBottom: "0.5rem" }}>AGENT ACADEMY</div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 800, color: "#DCE8F0", margin: "0 0 0.35rem", lineHeight: 1.1 }}>What do you want to automate?</h1>
          <p style={{ fontFamily: "monospace", fontSize: "0.62rem", color: "#3D5568", margin: "0 0 1.25rem", lineHeight: 1.6 }}>Describe what you do today and what you wish happened automatically. Plain English is perfect.</p>
          <textarea value={preStepText} onChange={e => setPreStepText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && e.metaKey && preStepText.trim() && phase !== "classifying") handlePreStepSubmit(); }}
            placeholder="e.g. I receive RFI documents from contractors and need to analyze them — figure out if they are legitimate change requests, estimate cost and schedule impact, and draft a response. Right now I do this manually which takes hours per RFI."
            rows={5} disabled={phase === "classifying"}
            style={{ width: "100%", background: "#0F1720", border: "1px solid " + (preStepText ? "#F97316" + "55" : "#182430"), borderRadius: "10px", padding: "0.9rem", color: "#DCE8F0", fontFamily: "monospace", fontSize: "0.75rem", lineHeight: 1.7, resize: "none", marginBottom: "0.75rem" }} />
          {classifyError && <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#EF4444", marginBottom: "0.5rem" }}>{classifyError}</div>}
          <button onClick={handlePreStepSubmit} disabled={!preStepText.trim() || phase === "classifying"}
            style={{ width: "100%", background: (preStepText.trim() && phase !== "classifying") ? "linear-gradient(135deg,#F97316,#F59E0B)" : "#1A2535", border: "none", borderRadius: "8px", padding: "0.85rem", color: (preStepText.trim() && phase !== "classifying") ? "#000" : "#3D5568", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: (preStepText.trim() && phase !== "classifying") ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            {phase === "classifying" ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>◌</span> Designing your agent...</> : "Build My Agent →"}
          </button>
          <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#3D5568", textAlign: "center", marginTop: "0.65rem" }}>Your first run is free. No card required to start.</div>
        </div>
      </div>
    );
  }

  // ── CLARIFYING ────────────────────────────────────────────────

  if (phase === "clarifying") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem", fontFamily: "'Syne', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} @keyframes fadeup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}} .fade{animation:fadeup 0.3s ease}`}</style>
        <div className="fade" style={{ background: "#0B0F16", border: "1px solid #182430", borderRadius: "14px", width: "100%", maxWidth: "540px", padding: "2rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#22D3EE", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>ONE QUICK QUESTION</div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#DCE8F0", margin: "0 0 1rem", lineHeight: 1.25 }}>{classification?.clarifying_question}</h2>
          <input value={clarifyingAnswer} onChange={e => setClarifyingAnswer(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && clarifyingAnswer.trim()) handleClarifyingSubmit(); }} placeholder="Your answer..."
            style={{ width: "100%", background: "#0F1720", border: "1px solid #182430", borderRadius: "8px", padding: "0.75rem", color: "#DCE8F0", fontFamily: "monospace", fontSize: "0.72rem", marginBottom: "0.65rem" }} />
          <div style={{ display: "flex", gap: "0.45rem" }}>
            <button onClick={handleClarifyingSubmit} disabled={!clarifyingAnswer.trim()}
              style={{ flex: 1, background: clarifyingAnswer.trim() ? "linear-gradient(135deg,#F97316,#F59E0B)" : "#1A2535", border: "none", borderRadius: "8px", padding: "0.7rem", color: clarifyingAnswer.trim() ? "#000" : "#3D5568", fontFamily: "monospace", fontSize: "0.65rem", fontWeight: 800, cursor: clarifyingAnswer.trim() ? "pointer" : "not-allowed" }}>
              Continue →
            </button>
            <button onClick={() => { setClassification(prev => ({ ...prev, clarifying_question: null })); setData(d => ({ ...d, concept: preStepText })); setPhase("steps"); setCurrentStepIndex(0); }}
              style={{ background: "transparent", border: "1px solid #182430", borderRadius: "8px", padding: "0.7rem 1rem", color: "#3D5568", fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer" }}>Skip</button>
          </div>
        </div>
      </div>
    );
  }

  // ── BLUEPRINT ────────────────────────────────────────────────

  if (phase === "blueprint" && blueprint) {
    const bpStr = JSON.stringify(blueprint, null, 2);
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem", fontFamily: "'Syne', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} @keyframes fadeup{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}} .fade{animation:fadeup 0.3s ease}`}</style>
        <div className="fade" style={{ background: "#0B0F16", border: "1px solid #182430", borderRadius: "14px", width: "100%", maxWidth: "700px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid #182430", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: "#22C55E", letterSpacing: "0.1em", marginBottom: "0.15rem" }}>✓ AGENT READY</div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: "#DCE8F0" }}>{data.name || "Your Agent"} is ready to launch.</div>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(bpStr); setBpCopied(true); setTimeout(() => setBpCopied(false), 2000); }}
              style={{ background: bpCopied ? "#22C55E" : "linear-gradient(135deg,#F97316,#F59E0B)", border: "none", borderRadius: "7px", padding: "0.5rem 0.9rem", color: bpCopied ? "#fff" : "#000", fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: "pointer" }}>
              {bpCopied ? "✓ COPIED" : "COPY BLUEPRINT"}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem" }}>
            <div style={{ background: "#1A2535", border: "1px solid #182430", borderRadius: "8px", padding: "0.85rem 1rem", marginBottom: "1rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#F97316", letterSpacing: "0.08em", marginBottom: "0.6rem" }}>YOUR AGENT AT A GLANCE</div>
              {[
                { label: "WHAT IT DOES", value: data.concept },
                { label: "WHAT IT READS", value: data.inputs },
                { label: "WHAT IT PRODUCES", value: data.outputs },
                { label: "ALWAYS HAS ACCESS TO", value: standingDocs.length > 0 ? standingDocs.map(d=>d.name).join(", ") : "Nothing yet — add from your dashboard" },
                { label: "OVERSIGHT", value: humanGates.filter(g=>g.enabled).length > 0 ? humanGates.filter(g=>g.enabled).map(g=>g.label).join("; ") : "Runs automatically, output for your review" },
              ].filter(i=>i.value).map((item,i) => (
                <div key={i} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", marginBottom: "0.35rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.42rem", color: "#F97316", flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "95px" }}>{item.label}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.57rem", color: "#A0B8C8", lineHeight: 1.55 }}>{item.value.length > 90 ? item.value.substring(0,90)+"..." : item.value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.46rem", color: "#3D5568", marginBottom: "0.35rem" }}>DEPLOYABLE BLUEPRINT — Claude Code reads this to build your agent</div>
            <pre style={{ background: "#040608", border: "1px solid #1A2535", borderRadius: "8px", padding: "0.85rem", fontFamily: "monospace", fontSize: "0.57rem", color: "#7090A8", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: "0 0 1rem", maxHeight: "260px", overflowY: "auto" }}>{bpStr}</pre>
            <div style={{ background: "#1A2535", border: "1px solid " + "#F59E0B" + "33", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "0.65rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#F59E0B", marginBottom: "0.4rem" }}>YOUR FIRST RUN IS FREE</div>
              {["Your agent is built and ready to run","Upload a real file to see it work — this run is on us","After that, $199/month keeps it running, monitored, and improving","Everything you need to manage and improve it is in your dashboard"].map((s,i) => (
                <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.2rem" }}>
                  <span style={{ color: "#F59E0B", fontFamily: "monospace", fontSize: "0.56rem", flexShrink: 0 }}>{i+1}.</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#A0B8C8", lineHeight: 1.5 }}>{s}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { setBlueprint(null); setPhase("pre_step"); setData({}); setCurrentStepIndex(0); setClassification(null); setPreStepText(""); setStandingDocs([]); setHumanGates([]); setTemplateFile(null); setTemplateAnalysis(null); }}
              style={{ width: "100%", background: "transparent", border: "1px solid #182430", borderRadius: "8px", padding: "0.55rem", color: "#3D5568", fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>
              Build a different agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── STEPS ────────────────────────────────────────────────────

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-end", fontFamily: "'Syne', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes fadeup{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} @keyframes spin{to{transform:rotate(360deg)}} .fadein{animation:fadeup 0.2s ease} .imodal{background:#0B0F16;border:1px solid #182430;width:100%;max-width:560px;border-radius:16px 16px 0 0;border-bottom:none;max-height:94vh;display:flex;flex-direction:column;overflow:hidden} @media(min-width:700px){.iwrap{align-items:center!important;padding:2rem!important}.imodal{border-radius:14px!important;border-bottom:1px solid #182430!important;max-height:88vh!important}} @media(min-width:1100px){.imodal{max-width:720px!important}}`}</style>

      <div className="iwrap" style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", width: "100%" }}>
        <div className="imodal">

          {/* Progress header */}
          <div style={{ padding: "0.85rem 1.25rem 0.6rem", borderBottom: "1px solid #182430", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.38rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: "#F97316", letterSpacing: "0.09em" }}>
                {classification?.workflow_type?.replace(/_/g," ").toUpperCase() || "AGENT ACADEMY"}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: "#3D5568" }}>{pct}%</span>
            </div>
            <div style={{ height: "3px", background: "#1A2535", borderRadius: "2px", overflow: "hidden", marginBottom: "0.3rem" }}>
              <div style={{ width: pct+"%", height: "100%", background: "linear-gradient(90deg,#F97316,#F59E0B)", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              {requiredSteps.map((_,i) => <div key={i} style={{ flex: 1, height: "2px", borderRadius: "1px", background: i < currentStepIndex ? "#F97316" : i === currentStepIndex ? "#F59E0B" : "#1A2535", transition: "background 0.3s" }} />)}
            </div>
          </div>

          {/* Step body */}
          <div className="fadein" style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem 0.5rem" }} key={currentStepKey}>
            <h2 style={{ fontWeight: 800, fontSize: "1.35rem", margin: "0 0 0.2rem", color: "#DCE8F0", lineHeight: 1.15 }}>{curConfig.headline}</h2>
            <p style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#3D5568", margin: "0 0 0.75rem", lineHeight: 1.6 }}>
              {curConfig.sub}{curConfig.optional ? <span style={{ color: "#F97316" }}> — optional</span> : null}
            </p>

            {/* Suggestion */}
            {!curConfig.noCoach && !val && (
              suggestionLoading ? (
                <div style={{ background: "#1A2535", border: "1px solid #F59E0B22", borderRadius: "10px", padding: "0.6rem 0.8rem", marginBottom: "0.65rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "#F59E0B", display: "inline-block", animation: "spin 1s linear infinite" }}>◌</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.55rem", color: "#F59E0B" }}>Preparing suggestion for your agent...</span>
                </div>
              ) : suggestion ? (
                <SuggestionCard suggestion={suggestion} stepKey={currentStepKey}
                  onUse={s => { setData(p => ({ ...p, [currentStepKey]: s })); setSuggestion(""); }}
                  onSkip={() => setSuggestion("")} />
              ) : null
            )}

            {/* Step content */}
            {currentStepKey === "standing_context" ? (
              <StandingContextStep classification={classification} standingDocs={standingDocs} setStandingDocs={setStandingDocs} />
            ) : currentStepKey === "human_gates" ? (
              <HumanGatesStep classification={classification} data={data} humanGates={humanGates} setHumanGates={setHumanGates} />
            ) : currentStepKey === "template" ? (
              <div>
                <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: "#3D5568", marginBottom: "0.6rem", lineHeight: 1.5 }}>Upload your existing template or skip and we will use a standard format you can refine later.</div>
                {templateFile ? (
                  <div>
                    <div style={{ background: "#22C55E0D", border: "1px solid #22C55E44", borderRadius: "8px", padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ color: "#22C55E" }}>✓</span>
                        <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: "#DCE8F0" }}>{templateFile.name}</span>
                      </div>
                      <button onClick={() => { setTemplateFile(null); setTemplateAnalysis(null); setData(p => ({ ...p, template: "" })); }} style={{ background: "transparent", border: "none", color: "#3D5568", cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>Remove</button>
                    </div>
                    {analyzingTemplate && <div style={{ fontFamily: "monospace", fontSize: "0.56rem", color: "#22D3EE", padding: "0.3rem 0" }}>◌ Analyzing template fields...</div>}
                    {templateAnalysis && !analyzingTemplate && (
                      <div style={{ background: "#040608", border: "1px solid #1A2535", borderRadius: "6px", padding: "0.5rem 0.7rem" }}>
                        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#22C55E", marginBottom: "0.25rem" }}>FIELDS DETECTED</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.57rem", color: "#80A890", lineHeight: 1.6, marginBottom: "0.3rem" }}>{templateAnalysis.summary}</div>
                        {templateAnalysis.source_document_fields?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                            {templateAnalysis.source_document_fields.slice(0,8).map((f,i) => <span key={i} style={{ background: "#22D3EE22", border: "1px solid #22D3EE33", borderRadius: "3px", padding: "0.06rem 0.3rem", fontFamily: "monospace", fontSize: "0.47rem", color: "#22D3EE" }}>{f}</span>)}
                          </div>
                        )}
                        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#3D5568", marginTop: "0.35rem" }}>Agent launches with this mapping. Refine it further from your dashboard.</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "#040608", border: "1px dashed #F59E0B44", borderRadius: "8px", padding: "0.75rem 0.85rem", cursor: "pointer" }}>
                    <span style={{ color: "#F59E0B", fontSize: "0.85rem" }}>+</span>
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#3D5568" }}>Upload your existing template</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#1A2535", marginTop: "0.08rem" }}>Excel, Word, PDF, CSV — your agent will follow your exact format</div>
                    </div>
                    <input ref={templateFileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }}
                      onChange={async e => {
                        const f = e.target.files[0]; if (!f) return;
                        setTemplateFile(f); setData(p => ({ ...p, template: f.name }));
                        setAnalyzingTemplate(true);
                        try { const a = await analyzeTemplate(f); setTemplateAnalysis(a); } catch {}
                        setAnalyzingTemplate(false);
                      }} />
                  </label>
                )}
              </div>
            ) : (
              <textarea value={val} onChange={e => setData(p => ({ ...p, [currentStepKey]: e.target.value }))} placeholder={curConfig.placeholder || ""} rows={4}
                style={{ width: "100%", background: "#0F1720", border: "1px solid " + (val ? "#F97316" + "55" : "#182430"), borderRadius: "10px", padding: "0.8rem", color: "#DCE8F0", fontFamily: "monospace", fontSize: "0.76rem", lineHeight: 1.7, resize: "none", transition: "border 0.2s", display: "block" }} />
            )}

            {/* Learn more */}
            {curConfig.learnMoreText && (
              <div style={{ marginTop: "0.4rem" }}>
                <button onClick={() => setLearnMore(l => !l)} style={{ background: "transparent", border: "none", color: "#3D5568", fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <span style={{ color: "#22D3EE" }}>?</span>{learnMore ? "Hide" : "Why does this matter?"}
                </button>
                {learnMore && <div style={{ background: "#1A2535", borderRadius: "6px", padding: "0.5rem 0.65rem", marginTop: "0.3rem" }}><div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#90B0C8", lineHeight: 1.65 }}>{curConfig.learnMoreText}</div></div>}
              </div>
            )}

            {/* Coaching hints */}
            {!curConfig.noCoach && val.trim().length > 0 && (
              <div style={{ marginTop: "0.6rem" }}>
                {hintsLoading && <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><span style={{ color: "#22D3EE", fontSize: "0.6rem" }}>◌</span><span style={{ fontFamily: "monospace", fontSize: "0.56rem", color: "#22D3EE" }}>Reviewing...</span></div>}
                {!hintsLoading && hints.length > 0 && (
                  <>
                    <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: "#22D3EE", letterSpacing: "0.06em", marginBottom: "0.4rem" }}>WHAT'S MISSING — click to add</div>
                    {hints.map((h, i) => <HintCard key={i} hint={h} index={i} addedOptions={addedOptions[i]||[]} onInject={handleInject} onUndo={handleUndo} onDiscuss={gap => { setChatOpen(true); setChatHistory([{ role: "assistant", content: "Let's talk about: \"" + gap + "\". How does this apply to your workflow?" }]); }} />)}
                  </>
                )}
              </div>
            )}

            {/* Blueprint so far */}
            {currentStepIndex > 0 && Object.keys(data).filter(k => data[k] && k !== "name").length > 0 && (
              <div style={{ marginTop: "0.75rem", background: "#040608", border: "1px solid #1A2535", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.35rem 0.6rem", background: "#1A2535", borderBottom: "1px solid #182430", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.44rem", color: "#3D5568", letterSpacing: "0.07em" }}>AGENT BLUEPRINT SO FAR</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.44rem", color: "#F97316" }}>{currentStepKey}</span>
                </div>
                <div style={{ padding: "0.5rem 0.6rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {[
                    { label: "WHAT IT DOES", value: data.concept },
                    { label: "READS", value: data.inputs },
                    { label: "PRODUCES", value: data.outputs },
                    { label: "TEMPLATE", value: data.template },
                    { label: "CONTEXT", value: data.standing_context_summary || (standingDocs.length > 0 ? standingDocs.length + " docs uploaded" : null) },
                    { label: "OVERSIGHT", value: data.human_gates_summary },
                  ].filter(i => i.value).map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: "0.45rem", alignItems: "flex-start" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "0.41rem", color: "#F97316", flexShrink: 0, minWidth: "55px", letterSpacing: "0.05em" }}>{item.label}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.53rem", color: "#5A8898", lineHeight: 1.5 }}>{item.value.length > 80 ? item.value.substring(0,80)+"..." : item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat */}
            <div style={{ marginTop: "0.65rem", marginBottom: "0.4rem" }}>
              <ChatBox open={chatOpen} onToggle={() => { setChatOpen(p => !p); if (!chatOpen && chatHistory.length === 0) setChatHistory([{ role: "assistant", content: "This step: \"" + (curConfig.headline||currentStepKey) + "\". What would you like to know?" }]); }} history={chatHistory} onSend={handleChatSend} loading={chatLoading} />
              {chatOpen && chatSolution && (
                <div style={{ marginTop: "0.4rem", background: "#22C55E0F", border: "1px solid #22C55E44", borderRadius: "8px", padding: "0.55rem 0.7rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: "#22C55E", marginBottom: "0.25rem" }}>SOLUTION — READY TO ADD</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: "#DCE8F0", lineHeight: 1.5, marginBottom: "0.4rem" }}>"{chatSolution}"</div>
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    <button onClick={() => { setData(p => ({ ...p, [currentStepKey]: (p[currentStepKey]||"").trimEnd() + " " + chatSolution })); setChatSolution(""); }}
                      style={{ flex: 1, background: "#22C55E", border: "none", borderRadius: "5px", padding: "0.38rem", color: "#000", fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: "pointer" }}>+ Add</button>
                    <button onClick={() => setChatSolution("")} style={{ background: "transparent", border: "1px solid #182430", borderRadius: "5px", padding: "0.38rem 0.55rem", color: "#3D5568", fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>Discard</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: "0.65rem 1.25rem 0.85rem", borderTop: "1px solid #182430", flexShrink: 0, display: "flex", gap: "0.4rem" }}>
            {currentStepIndex > 0 && <button onClick={goBack} style={{ background: "transparent", border: "1px solid #182430", borderRadius: "8px", padding: "0.6rem 0.85rem", color: "#3D5568", fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", flexShrink: 0 }}>Back</button>}
            {curConfig.optional && <button onClick={() => setCurrentStepIndex(i => i+1)} style={{ background: "transparent", border: "1px solid #182430", borderRadius: "8px", padding: "0.6rem 0.85rem", color: "#3D5568", fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", flexShrink: 0 }}>Skip</button>}
            <button onClick={goNext} disabled={!canProceed || hintsLoading}
              style={{ flex: 1, background: (canProceed && !hintsLoading) ? "linear-gradient(135deg,#F97316,#F59E0B)" : "#1A2535", border: "none", borderRadius: "8px", padding: "0.72rem", color: canProceed ? "#000" : "#3D5568", fontFamily: "monospace", fontSize: "0.66rem", fontWeight: 800, cursor: canProceed ? "pointer" : "not-allowed", transition: "background 0.2s" }}>
              {isLastStep ? "BUILD MY BLUEPRINT →" : "NEXT →"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
