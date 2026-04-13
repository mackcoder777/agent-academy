import { useState, useRef, useEffect, useCallback } from "react";

// ─── Design tokens (same system as SmartIntake) ───────────────────────────
const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
  purple: "#A78BFA", error: "#EF4444",
};

// ─── Helpers ──────────────────────────────────────────────────────────────
const uuid = () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));

const callClaude = async (messages, system, max_tokens = 1000) => {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens,
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
  const m = s.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
};

const readFileAsText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = e => resolve(e.target.result);
  r.onerror = reject;
  if (file.type === "application/pdf") r.readAsDataURL(file);
  else r.readAsText(file);
});

const fmtDuration = ms => ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
const fmtCost = tokens => "$" + ((tokens || 0) * 0.000003).toFixed(4);
const fmtTime = ts => new Date(ts).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });

// ─── Normalize agentData from SmartIntake v5 or v6 format ────────────────
const normalizeBlueprint = (raw) => {
  if (!raw) return null;
  if (raw.agent_id && raw.runtime_inputs) return raw;
  return {
    agent_id: uuid(),
    agent_name: raw.agentName || raw.name || "My Agent",
    industry: raw.industry || "general",
    workflow_type: raw.workflow_type || "document_processor",
    agent_class: raw.agent_class || "document_processor",
    complexity: raw.complexity || "medium",
    concept: raw.concept || "",
    trigger: { type: "manual_upload", accepted_formats: ["pdf","txt","csv","docx","xlsx"] },
    runtime_inputs: [{ name: "input_document", type: "file", required: true }],
    standing_context: raw.crossReference || raw.knowledge ? [
      raw.crossReference && { name: "cross_reference", category: "crossref", description: raw.crossReference },
      raw.knowledge && { name: "knowledge_base", category: "reference_data", description: raw.knowledge },
    ].filter(Boolean) : [],
    output: {
      format: "structured_output",
      description: raw.outputs || "",
    },
    human_gates: raw.constraints ? [{ trigger: raw.constraints, action: "pause_and_notify" }] : [],
    system_prompt: { role: "", constraints: [] },
    failure_handling: { unreadable_document: "pause_and_notify", low_confidence: "flag_and_continue" },
    observability: { log_every_run: true },
    pricing: { free_runs: 1 },
    _raw: raw,
  };
};

// ─── Build system prompt for execution from blueprint ─────────────────────
const buildSystemPromptFromBlueprint = (bp) => {
  const parts = [];
  parts.push(`You are ${bp.agent_name} — a specialized AI agent.`);
  if (bp.concept) parts.push(`\nWHAT YOU DO: ${bp.concept}`);
  if (bp.output?.description) parts.push(`\nOUTPUT: ${bp.output.description}`);
  if (bp.system_prompt?.role) parts.push(`\nROLE: ${bp.system_prompt.role}`);
  if (bp.system_prompt?.constraints?.length) {
    parts.push(`\nRULES:\n${bp.system_prompt.constraints.map(c => "- " + c).join("\n")}`);
  }
  if (bp.human_gates?.length) {
    parts.push(`\nHUMAN OVERSIGHT: Flag for human review when: ${bp.human_gates.map(g => g.trigger || g.action).join("; ")}`);
  }
  parts.push(`
Process the runtime input provided and return ONLY valid JSON with this exact structure:
{
  "detected": "one sentence: what type of content or document this is",
  "extracted": { "field_name": "value found", "field_name_2": "value found" },
  "analysis": "2-4 sentences of plain English analysis and reasoning — what you found and what it means",
  "output": "the full formatted output this agent produces — be specific and complete, include actual values from the input",
  "confidence": 0.85,
  "flags": ["any issues, conflicts, missing data, or items needing human review — empty array if none"],
  "next_steps": ["what the human operator should do with this output"]
}

Be specific. Use actual values from the input. Never use placeholders.`);
  return parts.join("");
};

// ─── LAUNCH SEQUENCE ─────────────────────────────────────────────────────
const LAUNCH_STEPS = [
  { label: "Compiling blueprint", detail: "Normalizing agent specification..." },
  { label: "Building your agent", detail: "Generating execution layer from blueprint..." },
  { label: "Initializing memory", detail: "Setting up run logging and state persistence..." },
  { label: "Deploying", detail: "Agent going live on execution infrastructure..." },
];

function LaunchScreen({ agentData, onLaunched }) {
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState("");
  const bp = useRef(null);
  const systemPrompt = useRef("");

  useEffect(() => {
    const run = async () => {
      try {
        await new Promise(r => setTimeout(r, 600));
        bp.current = normalizeBlueprint(agentData);
        setPhase(1);

        const raw = agentData?._raw || agentData;
        const context = [
          raw?.concept && "CONCEPT: " + raw.concept,
          raw?.inputs && "READS: " + raw.inputs,
          raw?.outputs && "PRODUCES: " + raw.outputs,
          raw?.systems && "SYSTEMS: " + raw.systems,
          raw?.constraints && "HUMAN GATES: " + raw.constraints,
        ].filter(Boolean).join("\n");

        const promptGen = await callClaude([{
          role: "user",
          content: `You are generating the execution system prompt for an AI agent.

Blueprint:
${context || JSON.stringify(bp.current, null, 2).slice(0, 1000)}

Generate a precise, production-ready system prompt for this agent. Include:
1. Clear role definition (one sentence)
2. Core capabilities and what it handles
3. Output quality standards
4. Edge case handling instructions
5. What to flag for human review

Return ONLY the system prompt text. No preamble. No JSON. Plain text.`
        }], "", 600);

        systemPrompt.current = promptGen || buildSystemPromptFromBlueprint(bp.current);
        setPhase(2);

        await new Promise(r => setTimeout(r, 500));
        setPhase(3);

        await new Promise(r => setTimeout(r, 900));
        setPhase(4);

        setTimeout(() => onLaunched(bp.current, systemPrompt.current), 600);
      } catch (e) {
        setError("Launch failed: " + e.message + ". Check your API connection.");
      }
    };
    run();
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: C.bg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Syne', sans-serif", zIndex: 1000,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        @keyframes live { 0%{box-shadow:0 0 0 0 #22C55E44}100%{box-shadow:0 0 0 12px transparent} }
      `}</style>

      <div style={{ width: "100%", maxWidth: "480px", padding: "2rem" }}>
        <div style={{ marginBottom: "2.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, letterSpacing: "0.1em", marginBottom: "0.35rem" }}>
            AGENT ACADEMY — DEPLOYING
          </div>
          <div style={{ fontWeight: 800, fontSize: "1.8rem", color: C.text, lineHeight: 1.1 }}>
            {(agentData?.agentName || agentData?.agent_name || "Your Agent")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "2rem" }}>
          {LAUNCH_STEPS.map((s, i) => {
            const done = phase > i;
            const active = phase === i;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "0.85rem",
                opacity: done || active ? 1 : 0.3,
                transition: "opacity 0.4s ease",
              }}>
                <div style={{
                  width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
                  background: done ? C.success : active ? C.gold + "33" : C.dim,
                  border: "2px solid " + (done ? C.success : active ? C.gold : C.border),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  animation: active ? "pulse 1.2s ease infinite" : "none",
                }}>
                  {done && <span style={{ color: C.success, fontSize: "0.6rem", fontWeight: 700 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: done ? C.text : active ? C.gold : C.muted, fontWeight: done ? 600 : 400 }}>
                    {s.label}
                  </div>
                  {active && (
                    <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>
                      {s.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {phase >= 4 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.85rem 1.1rem", background: C.success + "0F", border: "1px solid " + C.success + "44", borderRadius: "10px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: C.success, animation: "live 1.5s ease infinite" }} />
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.success, fontWeight: 700 }}>AGENT LIVE</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>Launching dashboard...</div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: C.error + "15", border: "1px solid " + C.error + "44", borderRadius: "8px", padding: "0.75rem 1rem", marginTop: "1rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.error }}>{error}</div>
          </div>
        )}

        <div style={{ marginTop: "2rem", height: "3px", background: C.dim, borderRadius: "2px", overflow: "hidden" }}>
          <div style={{
            width: (phase / 4 * 100) + "%", height: "100%",
            background: phase >= 4 ? C.success : "linear-gradient(90deg," + C.accent + "," + C.gold + ")",
            borderRadius: "2px", transition: "width 0.8s ease, background 0.4s ease",
          }} />
        </div>
      </div>
    </div>
  );
}

// ─── OUTPUT DISPLAY ───────────────────────────────────────────────────────
function OutputDisplay({ result, compact }) {
  const confColor = result.confidence >= 0.8 ? C.success : result.confidence >= 0.6 ? C.gold : C.error;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.08em" }}>✓ RUN COMPLETE</div>
        <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: confColor, fontWeight: 700 }}>
          {Math.round((result.confidence || 0.85) * 100)}% confidence
        </div>
      </div>

      {result.detected && (
        <div style={{ background: C.dim, borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>DETECTED</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text }}>{result.detected}</div>
        </div>
      )}

      {result.extracted && Object.keys(result.extracted).length > 0 && (
        <div style={{ background: C.dim, borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.purple, letterSpacing: "0.07em", marginBottom: "0.35rem" }}>EXTRACTED</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {Object.entries(result.extracted).slice(0, compact ? 4 : 20).map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: "0.5rem" }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.purple, flexShrink: 0, minWidth: "120px" }}>{k}:</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.text, lineHeight: 1.5 }}>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.analysis && !compact && (
        <div style={{ background: C.dim, borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>ANALYSIS</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: "#B8D0DC", lineHeight: 1.65 }}>{result.analysis}</div>
        </div>
      )}

      {result.output && (
        <div style={{ background: C.code, border: "1px solid " + C.accent + "33", borderRadius: "6px", padding: "0.65rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>OUTPUT</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {compact ? result.output.slice(0, 200) + (result.output.length > 200 ? "..." : "") : result.output}
          </div>
        </div>
      )}

      {result.flags && result.flags.length > 0 && (
        <div style={{ background: C.gold + "0D", border: "1px solid " + C.gold + "33", borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>FLAGGED FOR REVIEW</div>
          {result.flags.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.15rem" }}>
              <span style={{ color: C.gold, flexShrink: 0, fontFamily: "monospace", fontSize: "0.55rem" }}>!</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#C8A820", lineHeight: 1.5 }}>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── STRIPE GATE MODAL ───────────────────────────────────────────────────
function StripeGateModal({ agentName, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem",
    }}>
      <div style={{
        background: C.surface, border: "1px solid " + C.accent + "55",
        borderRadius: "14px", width: "100%", maxWidth: "420px", padding: "2rem",
      }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
          FREE RUN USED
        </div>
        <div style={{ fontWeight: 800, fontSize: "1.4rem", color: C.text, lineHeight: 1.2, marginBottom: "0.75rem" }}>
          Your agent works.<br />Keep it running.
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.muted, lineHeight: 1.7, marginBottom: "1.5rem" }}>
          Your first run showed what {agentName} can do. Subscribe to keep it monitored, logged, and improving.
        </div>
        <div style={{ background: C.dim, borderRadius: "10px", padding: "1rem", marginBottom: "1.25rem" }}>
          {["Unlimited runs","Full run history + monitoring","Failure alerts via email","Dashboard improvements queue","Agent revision and redeploy"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <span style={{ color: C.success, fontFamily: "monospace", fontSize: "0.6rem" }}>+</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.text }}>{f}</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, textAlign: "center", marginBottom: "0.85rem" }}>
          $199 / month — cancel anytime
        </div>
        <button
          onClick={() => window.open("https://buy.stripe.com/agentacademy_placeholder", "_blank")}
          style={{ width: "100%", background: "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "9px", padding: "0.85rem", color: "#000", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer", marginBottom: "0.5rem" }}
        >
          SUBSCRIBE — $199/mo →
        </button>
        <button
          onClick={onClose}
          style={{ width: "100%", background: "transparent", border: "1px solid " + C.border, borderRadius: "9px", padding: "0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─── RUN HISTORY CARD ────────────────────────────────────────────────────
function RunCard({ run, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", overflow: "hidden", marginBottom: "0.5rem" }}>
      <div onClick={() => setExpanded(p => !p)} style={{ padding: "0.7rem 0.9rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.success, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text, marginBottom: "0.1rem" }}>Run #{index + 1} — {run.inputName || "Input"}</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>{fmtTime(run.ts)} · {fmtDuration(run.duration)} · {fmtCost(run.tokens)}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
          {run.isFree && <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>FREE</span>}
          {run.flags?.length > 0 && <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold }}>! {run.flags.length} flag{run.flags.length > 1 ? "s" : ""}</span>}
          <span style={{ color: C.muted, fontFamily: "monospace", fontSize: "0.7rem" }}>{expanded ? "▴" : "▾"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid " + C.border, padding: "0.75rem 0.9rem" }}>
          <OutputDisplay result={run.result} compact={false} />
        </div>
      )}
    </div>
  );
}

// ─── IMPROVEMENT QUEUE ───────────────────────────────────────────────────
function ImprovementQueue({ blueprint, runs }) {
  const [improvements, setImprovements] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const runSummary = runs.slice(-3).map((r, i) =>
        `Run ${i + 1}: detected="${r.result?.detected || "unknown"}", confidence=${r.result?.confidence || 0.85}, flags=${JSON.stringify(r.result?.flags || [])}`
      ).join("\n");
      const raw = await callClaude([{
        role: "user",
        content: `Agent: "${blueprint?.agent_name}"\nConcept: "${blueprint?.concept || ""}"\nStanding context uploaded: ${blueprint?.standing_context?.length > 0 ? "yes" : "no"}\nRecent runs:\n${runSummary}\n\nGenerate 3 specific improvement suggestions for this agent. Return ONLY JSON:\n[\n  {"title": "Add X to improve Y", "description": "Plain English: what to add and how it improves results", "action": "upload|configure|edit", "impact": "high|medium"},\n  {"title": "...", "description": "...", "action": "...", "impact": "..."},\n  {"title": "...", "description": "...", "action": "...", "impact": "..."}\n]`
      }], "", 600);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed)) setImprovements(parsed);
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => {
    if (runs.length > 0 && !improvements) generate();
  }, [runs.length]);

  if (runs.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.muted, lineHeight: 1.7 }}>
          Run your agent first.<br />Improvement suggestions are generated from actual run patterns.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1.5rem 0" }}>
        <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem" }}>○</span>
        <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.gold }}>Analyzing your runs...</span>
      </div>
    );
  }

  if (!improvements) return null;

  const impactColor = { high: C.success, medium: C.gold, low: C.muted };

  return (
    <div>
      <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.75rem" }}>
        {improvements.length} IMPROVEMENTS · ranked by impact
      </div>
      {improvements.map((imp, i) => (
        <div key={i} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", padding: "0.85rem 1rem", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, fontWeight: 600, lineHeight: 1.4, flex: 1, paddingRight: "0.5rem" }}>{imp.title}</div>
            <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: impactColor[imp.impact] || C.muted, background: (impactColor[imp.impact] || C.muted) + "22", padding: "0.1rem 0.5rem", borderRadius: "4px", flexShrink: 0 }}>{imp.impact} impact</span>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, lineHeight: 1.65, marginBottom: "0.55rem" }}>{imp.description}</div>
          <button style={{ background: "transparent", border: "1px solid " + C.accent + "44", borderRadius: "6px", padding: "0.35rem 0.75rem", color: C.accent, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer" }}>
            {imp.action === "upload" ? "+ Upload document" : imp.action === "configure" ? "Configure →" : "Edit →"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────
export default function AgentDashboard({ agentData, onBack }) {
  const [phase, setPhase] = useState("launching");
  const [blueprint, setBlueprint] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [activeTab, setActiveTab] = useState("run");
  const [runs, setRuns] = useState([]);
  const [freeRunsUsed, setFreeRunsUsed] = useState(0);
  const FREE_RUN_LIMIT = 1;
  const [running, setRunning] = useState(false);
  const [currentResult, setCurrentResult] = useState(null);
  const [runError, setRunError] = useState("");
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileB64, setFileB64] = useState(null);
  const [fileType, setFileType] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showStripeGate, setShowStripeGate] = useState(false);
  const fileRef = useRef(null);

  const onLaunched = useCallback((bp, sp) => {
    setBlueprint(bp);
    setSystemPrompt(sp);
    setPhase("live");
  }, []);

  const handleFile = async (file) => {
    setFileName(file.name);
    setFileType(file.type);
    setCurrentResult(null);
    setRunError("");
    try {
      const content = await readFileAsText(file);
      if (file.type === "application/pdf") {
        setFileB64(content.split(",")[1]);
        setInput("[PDF: " + file.name + "]");
      } else {
        setFileB64(null);
        setInput(content.substring(0, 5000));
      }
    } catch (e) {
      setRunError("Could not read file: " + e.message);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const runAgent = async () => {
    if (!input.trim() && !fileB64) return;
    if (freeRunsUsed >= FREE_RUN_LIMIT) { setShowStripeGate(true); return; }
    setRunning(true); setRunError(""); setCurrentResult(null);
    const startMs = Date.now();
    try {
      const effectiveSystem = systemPrompt || buildSystemPromptFromBlueprint(blueprint);
      let messages;
      if (fileB64 && fileType === "application/pdf") {
        messages = [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: fileB64 } }, { type: "text", text: "Process this document according to your specification. Return JSON only." }] }];
      } else {
        messages = [{ role: "user", content: "Process this input:\n\n" + (input.trim() || "File: " + fileName) + "\n\nReturn JSON only." }];
      }
      const raw = await callClaude(messages, effectiveSystem, 1200);
      const parsed = parseJSON(raw);
      const duration = Date.now() - startMs;
      if (parsed) {
        const run = { id: uuid(), ts: Date.now(), inputName: fileName || "Pasted input", result: parsed, duration, tokens: Math.round(duration * 0.4), flags: parsed.flags || [], isFree: freeRunsUsed < FREE_RUN_LIMIT };
        setCurrentResult(parsed); setRuns(p => [run, ...p]); setFreeRunsUsed(p => p + 1);
      } else {
        setRunError("Could not parse agent output. Try again.");
      }
    } catch (e) {
      setRunError("Run failed: " + e.message);
    }
    setRunning(false);
  };

  const clearRun = () => { setCurrentResult(null); setInput(""); setFileName(""); setFileB64(null); setFileType(""); setRunError(""); };

  if (phase === "launching") return <LaunchScreen agentData={agentData} onLaunched={onLaunched} />;

  const agentName = blueprint?.agent_name || agentData?.agentName || "My Agent";
  const totalRuns = runs.length;
  const successRate = totalRuns > 0 ? Math.round(runs.filter(r => !r.flags?.length).length / totalRuns * 100) : 100;
  const avgDuration = totalRuns > 0 ? Math.round(runs.reduce((a, r) => a + r.duration, 0) / totalRuns) : 0;
  const avgCost = totalRuns > 0 ? runs.reduce((a, r) => a + r.tokens, 0) / totalRuns : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, fontFamily: "'Syne', sans-serif", display: "flex", flexDirection: "column", zIndex: 1000 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        input, textarea { outline: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadein { from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none} }
        @keyframes live { 0%{box-shadow:0 0 0 0 #22C55E55}100%{box-shadow:0 0 0 8px transparent} }
        .fadein { animation: fadein 0.25s ease; }
        .drop-zone:hover { border-color: #F97316 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A2535; border-radius: 2px; }
      `}</style>

      <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          {onBack && <button onClick={onBack} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.3rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer" }}>← Back</button>}
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, letterSpacing: "0.08em" }}>AGENT ACADEMY</div>
            <div style={{ fontWeight: 800, fontSize: "1rem", color: C.text, lineHeight: 1.1 }}>{agentName}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: C.success + "0F", border: "1px solid " + C.success + "44", borderRadius: "20px", padding: "0.2rem 0.65rem" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.success, animation: "live 2s ease infinite" }} />
            <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.success, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted }}>
          {freeRunsUsed >= FREE_RUN_LIMIT
            ? <span style={{ color: C.accent }}>Subscribe to run →</span>
            : <span>{FREE_RUN_LIMIT - freeRunsUsed} free run{FREE_RUN_LIMIT - freeRunsUsed !== 1 ? "s" : ""} remaining</span>
          }
        </div>
      </div>

      {totalRuns > 0 && (
        <div style={{ display: "flex", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
          {[{ label: "RUNS", value: totalRuns }, { label: "SUCCESS", value: successRate + "%" }, { label: "AVG TIME", value: fmtDuration(avgDuration) }, { label: "AVG COST", value: fmtCost(avgCost) }].map((s, i) => (
            <div key={i} style={{ flex: 1, padding: "0.55rem 0.75rem", textAlign: "center", borderRight: i < 3 ? "1px solid " + C.border : "none" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.15rem" }}>{s.label}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: C.text, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
        {["run", "history", "improve"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "none", borderBottom: "2px solid " + (activeTab === tab ? C.accent : "transparent"), color: activeTab === tab ? C.text : C.muted, fontFamily: "monospace", fontSize: "0.6rem", fontWeight: activeTab === tab ? 700 : 400, cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {tab === "history" && totalRuns > 0 ? `History (${totalRuns})` : tab}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>

        {activeTab === "run" && (
          <div className="fadein">
            {!currentResult ? (
              <>
                <div className="drop-zone" onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileRef.current.click()} style={{ border: "1px dashed " + (dragOver ? C.accent : C.border), borderRadius: "10px", padding: "1.25rem 1rem", background: dragOver ? C.dim : C.card, cursor: "pointer", marginBottom: "0.65rem", display: "flex", alignItems: "center", gap: "0.75rem", transition: "all 0.2s" }}>
                  <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>+</span>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: fileName ? C.text : C.muted }}>{fileName || "Drop a file or click to upload"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>PDF, TXT, CSV, Excel, Word — anything your agent processes</div>
                  </div>
                </div>
                <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
                <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, textAlign: "center", marginBottom: "0.5rem" }}>OR PASTE CONTENT</div>
                <textarea value={fileB64 ? "" : input} onChange={e => { setInput(e.target.value); setFileB64(null); setFileName(""); }} placeholder="Paste the content your agent should process — an email, a spec excerpt, a data dump..." rows={5} style={{ width: "100%", background: C.card, border: "1px solid " + (input && !fileB64 ? C.accent + "55" : C.border), borderRadius: "10px", padding: "0.8rem", color: C.text, fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.65, resize: "none", marginBottom: "0.75rem" }} />
                {runError && <div style={{ background: C.error + "15", border: "1px solid " + C.error + "44", borderRadius: "7px", padding: "0.55rem 0.75rem", marginBottom: "0.65rem" }}><div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.error }}>{runError}</div></div>}
                <button onClick={runAgent} disabled={running || (!input.trim() && !fileB64)} style={{ width: "100%", background: running || (!input.trim() && !fileB64) ? C.dim : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "10px", padding: "0.85rem", color: running || (!input.trim() && !fileB64) ? C.muted : "#000", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: running || (!input.trim() && !fileB64) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  {running ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>○</span> Running {agentName}...</> : freeRunsUsed >= FREE_RUN_LIMIT ? "SUBSCRIBE TO RUN AGAIN →" : "RUN AGENT →"}
                </button>
                {freeRunsUsed < FREE_RUN_LIMIT && <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, textAlign: "center", marginTop: "0.5rem" }}>This is your free run. Unlimited runs from $199/month after.</div>}
              </>
            ) : (
              <div className="fadein">
                <OutputDisplay result={currentResult} compact={false} />
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
                  <button onClick={clearRun} style={{ flex: 1, background: C.dim, border: "1px solid " + C.border, borderRadius: "8px", padding: "0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>Run again</button>
                  <button onClick={() => { const blob = new Blob([JSON.stringify(currentResult, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = agentName.replace(/\s+/g, "_") + "_output.json"; a.click(); }} style={{ flex: 1, background: "transparent", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.6rem", color: C.success, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>↓ Download output</button>
                </div>
                {freeRunsUsed >= FREE_RUN_LIMIT && (
                  <div style={{ marginTop: "0.85rem", background: C.accent + "0D", border: "1px solid " + C.accent + "33", borderRadius: "10px", padding: "0.85rem 1rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>FREE RUN COMPLETE</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.text, lineHeight: 1.6, marginBottom: "0.65rem" }}>Your agent works. Subscribe to keep it running — every run monitored, logged, and improving.</div>
                    <button onClick={() => setShowStripeGate(true)} style={{ background: "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "7px", padding: "0.6rem 1.25rem", color: "#000", fontFamily: "monospace", fontSize: "0.65rem", fontWeight: 800, cursor: "pointer" }}>SUBSCRIBE — $199/mo →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="fadein">
            {runs.length === 0
              ? <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}><div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.muted, lineHeight: 1.7 }}>No runs yet.<br />Switch to Run tab and process your first document.</div></div>
              : runs.map((run, i) => <RunCard key={run.id} run={run} index={runs.length - 1 - i} />)
            }
          </div>
        )}

        {activeTab === "improve" && (
          <div className="fadein">
            <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", padding: "0.85rem 1rem", marginBottom: "1rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>AGENT DEFINITION</div>
              {[{ label: "Concept", value: blueprint?.concept || blueprint?._raw?.concept }, { label: "Reads", value: blueprint?._raw?.inputs }, { label: "Produces", value: blueprint?._raw?.outputs }, { label: "Standing context", value: blueprint?.standing_context?.length > 0 ? blueprint.standing_context.length + " document(s) uploaded" : "None — add from Improve queue" }].filter(i => i.value).map((item, i) => (
                <div key={i} style={{ display: "flex", gap: "0.6rem", marginBottom: "0.25rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, flexShrink: 0, minWidth: "80px", marginTop: "2px" }}>{item.label}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.muted, lineHeight: 1.55 }}>{item.value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.75rem" }}>IMPROVEMENT QUEUE</div>
            <ImprovementQueue blueprint={blueprint} runs={runs} />
          </div>
        )}
      </div>

      {showStripeGate && <StripeGateModal agentName={agentName} onClose={() => setShowStripeGate(false)} />}
    </div>
  );
}
