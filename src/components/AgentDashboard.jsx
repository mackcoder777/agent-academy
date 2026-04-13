import { useState, useRef, useEffect, useCallback } from "react";

const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
  purple: "#A78BFA", error: "#EF4444",
};

const uuid = () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));

const callClaude = async (messages, system, max_tokens = 1000) => {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens, messages, ...(system ? { system } : {}) }),
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
  file.type === "application/pdf" ? r.readAsDataURL(file) : r.readAsText(file);
});

const fmtDuration = ms => ms < 1000 ? ms + "ms" : (ms/1000).toFixed(1) + "s";
const fmtCost = tokens => "$" + ((tokens||0)*0.000003).toFixed(4);
const fmtTime = ts => new Date(ts).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });

// ─── Normalize blueprint from SmartIntake output ──────────────────────────────
const normalizeBlueprint = (agentData) => {
  if (!agentData) return null;
  const cls = agentData.classification || {};
  const ta = agentData.templateAnalysis || {};
  return {
    agent_name: agentData.agentName || agentData.agent_name || "My Agent",
    workflow_type: cls.workflow_type || "document_processor",
    output_is_form: cls.output_is_form || false,
    concept: agentData.concept || "",
    runtime_inputs: agentData.inputs || (cls.output_is_form ? "vendor quote documents" : "input documents"),
    output_description: agentData.outputs || (cls.output_is_form && agentData.template ? "completed " + agentData.template.split("—")[0].trim() : ""),
    template_name: agentData.templateFile?.name || null,
    template_summary: ta.summary || null,
    template_fields: ta.fields || [],
    auto_fillable: ta.auto_fillable || [],
    required_user_inputs: ta.required_user_inputs || [],
    human_gates: agentData.humanGate || "",
    _raw: agentData,
  };
};

// ─── Build system prompt from blueprint ───────────────────────────────────────
const buildSystemPrompt = (bp) => {
  const isForm = bp.output_is_form;
  const parts = [`You are ${bp.agent_name} — a specialized AI agent.`];
  if (bp.concept) parts.push(`\nWHAT YOU DO: ${bp.concept}`);

  if (isForm && bp.template_fields.length > 0) {
    parts.push(`\nOUTPUT FORM: You fill out a form with these fields: ${bp.template_fields.join(", ")}`);
    if (bp.auto_fillable.length > 0) parts.push(`AUTO-FILL FROM SOURCE: ${bp.auto_fillable.join(", ")}`);
    if (bp.required_user_inputs.length > 0) parts.push(`USER-PROVIDED FIELDS: ${bp.required_user_inputs.join(", ")} (user supplies these — they are NOT in the source document)`);
  } else if (bp.output_description) {
    parts.push(`\nOUTPUT: ${bp.output_description}`);
  }

  if (bp.human_gates) parts.push(`\nHUMAN OVERSIGHT: ${bp.human_gates}`);

  parts.push(`\nProcess the runtime input provided. Return ONLY valid JSON:
{
  "detected": "one sentence: what type of document or content this is",
  "extracted": { "field_name": "value_found" },
  "output": "the full formatted output — use actual values, never placeholders",
  "field_results": [{"field": "form field name", "value": "extracted or computed value", "source": "auto|user_provided|computed", "confidence": 0.95}],
  "missing_fields": ["field name if it could not be filled"],
  "flags": ["any issues needing human review — empty array if none"],
  "confidence": 0.92
}

Rules:
- Use actual values from the input — never placeholders
- For form-filling: populate field_results for every field in the form
- Mark fields as "user_provided" if they came from the user-supplied context, not the source doc
- Flag anything with confidence below 0.8
- missing_fields: list any required fields that could not be found anywhere`);

  return parts.join("\n");
};

// ─── LAUNCH SCREEN ────────────────────────────────────────────────────────────
const LAUNCH_STEPS = [
  { label: "Compiling blueprint", detail: "Normalizing agent specification..." },
  { label: "Building execution layer", detail: "Generating system prompt from blueprint..." },
  { label: "Configuring form mapping", detail: "Setting up field extraction rules..." },
  { label: "Deploying", detail: "Agent going live..." },
];

function LaunchScreen({ agentData, onLaunched }) {
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState("");
  const bpRef = useRef(null);
  const spRef = useRef("");

  useEffect(() => {
    const run = async () => {
      try {
        await new Promise(r => setTimeout(r, 400));
        bpRef.current = normalizeBlueprint(agentData);
        setPhase(1);

        // Generate optimized system prompt
        const raw = agentData?._raw || agentData;
        const ctx = [
          raw?.concept && "CONCEPT: " + raw.concept,
          raw?.inputs && "READS: " + raw.inputs,
          raw?.outputs && "PRODUCES: " + raw.outputs,
          raw?.templateAnalysis?.fields && "FORM FIELDS: " + raw.templateAnalysis.fields.join(", "),
          raw?.templateAnalysis?.required_user_inputs && "USER PROVIDES: " + raw.templateAnalysis.required_user_inputs.join(", "),
          raw?.templateAnalysis?.auto_fillable && "AUTO-FILL FROM SOURCE: " + raw.templateAnalysis.auto_fillable.join(", "),
          raw?.humanGate && "HUMAN GATES: " + raw.humanGate,
        ].filter(Boolean).join("\n");

        const generated = await callClaude([{ role: "user", content: `Generate a production system prompt for this AI agent.\n\nBlueprint:\n${ctx}\n\nInclude: role, capabilities, field extraction rules, what to flag for human review.\nReturn ONLY the system prompt text. No preamble.` }], "", 600);
        spRef.current = generated || buildSystemPrompt(bpRef.current);
        setPhase(2);

        await new Promise(r => setTimeout(r, 400));
        setPhase(3);
        await new Promise(r => setTimeout(r, 600));
        setPhase(4);
        setTimeout(() => onLaunched(bpRef.current, spRef.current), 500);
      } catch (e) {
        setError("Launch failed: " + e.message);
      }
    };
    run();
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", zIndex: 1000 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}} @keyframes live{0%{box-shadow:0 0 0 0 #22C55E44}100%{box-shadow:0 0 0 12px transparent}}`}</style>
      <div style={{ width: "100%", maxWidth: "480px", padding: "2rem" }}>
        <div style={{ marginBottom: "2.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, letterSpacing: "0.1em", marginBottom: "0.35rem" }}>AGENT ACADEMY — DEPLOYING</div>
          <div style={{ fontWeight: 800, fontSize: "1.8rem", color: C.text, lineHeight: 1.1 }}>{agentData?.agentName || agentData?.agent_name || "Your Agent"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "2rem" }}>
          {LAUNCH_STEPS.map((s, i) => {
            const done = phase > i; const active = phase === i;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.85rem", opacity: done || active ? 1 : 0.3, transition: "opacity 0.4s" }}>
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, background: done ? C.success : active ? C.gold + "33" : C.dim, border: "2px solid " + (done ? C.success : active ? C.gold : C.border), display: "flex", alignItems: "center", justifyContent: "center", animation: active ? "pulse 1.2s ease infinite" : "none" }}>
                  {done && <span style={{ color: C.success, fontSize: "0.6rem", fontWeight: 700 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: done ? C.text : active ? C.gold : C.muted, fontWeight: done ? 600 : 400 }}>{s.label}</div>
                  {active && <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>{s.detail}</div>}
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
        {error && <div style={{ background: C.error + "15", border: "1px solid " + C.error + "44", borderRadius: "8px", padding: "0.75rem 1rem", marginTop: "1rem" }}><div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.error }}>{error}</div></div>}
        <div style={{ marginTop: "2rem", height: "3px", background: C.dim, borderRadius: "2px", overflow: "hidden" }}>
          <div style={{ width: (phase/4*100) + "%", height: "100%", background: phase >= 4 ? C.success : "linear-gradient(90deg," + C.accent + "," + C.gold + ")", borderRadius: "2px", transition: "width 0.8s ease" }} />
        </div>
      </div>
    </div>
  );
}

// ─── PRE-RUN USER INPUT ───────────────────────────────────────────────────────
// Collects user-provided fields (GL account, project number, etc.) before running
function PreRunInputs({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div style={{ background: C.gold + "0A", border: "1px solid " + C.gold + "33", borderRadius: "10px", padding: "0.85rem 1rem", marginBottom: "0.75rem" }}>
      <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.5rem" }}>
        FIELDS YOU'LL PROVIDE — these won't be in the vendor quote
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {fields.map((field, i) => (
          <div key={i}>
            <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, marginBottom: "0.2rem" }}>{field}</div>
            <input
              value={values[field] || ""}
              onChange={e => onChange(field, e.target.value)}
              placeholder={"Enter " + field.toLowerCase() + "..."}
              style={{ width: "100%", background: C.card, border: "1px solid " + C.border, borderRadius: "6px", padding: "0.45rem 0.65rem", color: C.text, fontFamily: "monospace", fontSize: "0.65rem", outline: "none" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── OUTPUT DISPLAY ───────────────────────────────────────────────────────────
function OutputDisplay({ result, blueprint, compact }) {
  const confColor = (result.confidence || 0.85) >= 0.8 ? C.success : (result.confidence || 0.85) >= 0.6 ? C.gold : C.error;
  const isForm = blueprint?.output_is_form;
  const fieldResults = result.field_results || [];
  const missingFields = result.missing_fields || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.08em" }}>✓ RUN COMPLETE</div>
        <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: confColor, fontWeight: 700 }}>{Math.round((result.confidence || 0.85) * 100)}% confidence</div>
      </div>

      {result.detected && (
        <div style={{ background: C.dim, borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>DETECTED</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text }}>{result.detected}</div>
        </div>
      )}

      {/* Form-filling: show field-by-field table */}
      {isForm && fieldResults.length > 0 && (
        <div style={{ background: C.dim, borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.purple, letterSpacing: "0.07em", marginBottom: "0.4rem" }}>FORM FIELDS FILLED</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {(compact ? fieldResults.slice(0, 5) : fieldResults).map((fr, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, flexShrink: 0, minWidth: "120px" }}>{fr.field}:</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: fr.source === "user_provided" ? C.gold : C.text, flex: 1 }}>{fr.value || "—"}</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.44rem", color: (fr.confidence || 1) >= 0.8 ? "#2A5A3A" : C.gold, flexShrink: 0 }}>
                  {fr.source === "user_provided" ? "you" : Math.round((fr.confidence || 0.95) * 100) + "%"}
                </span>
              </div>
            ))}
            {compact && fieldResults.length > 5 && <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted }}>+{fieldResults.length - 5} more fields</div>}
          </div>
          {missingFields.length > 0 && (
            <div style={{ marginTop: "0.5rem", borderTop: "1px solid " + C.border, paddingTop: "0.4rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.error, marginBottom: "0.2rem" }}>COULD NOT FILL:</div>
              {missingFields.map((f, i) => <div key={i} style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.error }}>· {f}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Non-form: show extracted key-values */}
      {!isForm && result.extracted && Object.keys(result.extracted).length > 0 && (
        <div style={{ background: C.dim, borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.purple, letterSpacing: "0.07em", marginBottom: "0.35rem" }}>EXTRACTED</div>
          {Object.entries(result.extracted).slice(0, compact ? 4 : 20).map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.15rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.purple, flexShrink: 0, minWidth: "110px" }}>{k}:</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.text }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Output text */}
      {result.output && (
        <div style={{ background: C.code, border: "1px solid " + C.accent + "33", borderRadius: "6px", padding: "0.65rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>OUTPUT</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {compact ? result.output.slice(0, 200) + (result.output.length > 200 ? "..." : "") : result.output}
          </div>
        </div>
      )}

      {/* Flags */}
      {result.flags && result.flags.length > 0 && (
        <div style={{ background: C.gold + "0D", border: "1px solid " + C.gold + "33", borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>FLAGGED FOR REVIEW</div>
          {result.flags.map((f, i) => <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.15rem" }}><span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.55rem" }}>!</span><span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#C8A820", lineHeight: 1.5 }}>{f}</span></div>)}
        </div>
      )}
    </div>
  );
}

// ─── STRIPE GATE ──────────────────────────────────────────────────────────────
function StripeGate({ agentName, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
      <div style={{ background: C.surface, border: "1px solid " + C.accent + "55", borderRadius: "14px", width: "100%", maxWidth: "420px", padding: "2rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, letterSpacing: "0.1em", marginBottom: "0.5rem" }}>FREE RUN USED</div>
        <div style={{ fontWeight: 800, fontSize: "1.4rem", color: C.text, lineHeight: 1.2, marginBottom: "0.75rem" }}>Your agent works.<br />Keep it running.</div>
        <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.muted, lineHeight: 1.7, marginBottom: "1.5rem" }}>
          Your first run showed what {agentName} can do. Subscribe to keep it monitored, logged, and improving.
        </div>
        <div style={{ background: C.dim, borderRadius: "10px", padding: "1rem", marginBottom: "1.25rem" }}>
          {["Unlimited runs", "Full run history + monitoring", "Failure alerts via email", "Dashboard improvement queue", "Agent revision and redeploy"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <span style={{ color: C.success, fontFamily: "monospace", fontSize: "0.6rem" }}>+</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.text }}>{f}</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, textAlign: "center", marginBottom: "0.85rem" }}>$199 / month — cancel anytime</div>
        <button onClick={() => window.open("https://buy.stripe.com/agentacademy_placeholder", "_blank")}
          style={{ width: "100%", background: "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "9px", padding: "0.85rem", color: "#000", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer", marginBottom: "0.5rem" }}>
          SUBSCRIBE — $199/mo →
        </button>
        <button onClick={onClose} style={{ width: "100%", background: "transparent", border: "1px solid " + C.border, borderRadius: "9px", padding: "0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>Maybe later</button>
      </div>
    </div>
  );
}

// ─── RUN CARD ─────────────────────────────────────────────────────────────────
function RunCard({ run, index, blueprint }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", overflow: "hidden", marginBottom: "0.5rem" }}>
      <div onClick={() => setExpanded(p => !p)} style={{ padding: "0.7rem 0.9rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: (run.result?.flags?.length || run.result?.missing_fields?.length) ? C.gold : C.success, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text, marginBottom: "0.1rem" }}>
              Run #{index + 1} — {run.inputName || "Input"}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>
              {fmtTime(run.ts)} · {fmtDuration(run.duration)} · {fmtCost(run.tokens)} · {Math.round((run.result?.confidence || 0.85) * 100)}% confidence
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
          {run.isFree && <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>FREE</span>}
          {(run.result?.flags?.length > 0 || run.result?.missing_fields?.length > 0) && (
            <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold }}>! review</span>
          )}
          <span style={{ color: C.muted, fontFamily: "monospace", fontSize: "0.7rem" }}>{expanded ? "▴" : "▾"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid " + C.border, padding: "0.75rem 0.9rem" }}>
          <OutputDisplay result={run.result} blueprint={blueprint} compact={false} />
          <button onClick={() => {
            const blob = new Blob([JSON.stringify(run.result, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url;
            a.download = (blueprint?.agent_name || "agent").replace(/\s+/g, "_") + "_run" + (index+1) + ".json"; a.click();
          }} style={{ marginTop: "0.5rem", background: "transparent", border: "1px solid " + C.success + "44", borderRadius: "6px", padding: "0.35rem 0.75rem", color: C.success, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer" }}>
            ↓ Download output
          </button>
        </div>
      )}
    </div>
  );
}

// ─── IMPROVE TAB ──────────────────────────────────────────────────────────────
function ImproveTab({ blueprint, runs }) {
  const [improvements, setImprovements] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const summary = runs.slice(-3).map((r, i) =>
        `Run ${i+1}: confidence=${r.result?.confidence||0.85}, missing=${JSON.stringify(r.result?.missing_fields||[])}, flags=${JSON.stringify(r.result?.flags||[])}`
      ).join("\n");
      const raw = await callClaude([{ role: "user", content: `Agent: "${blueprint?.agent_name}"\nConcept: "${blueprint?.concept}"\nForm fields: ${blueprint?.template_fields?.join(", ") || "not specified"}\nUser-provided fields: ${blueprint?.required_user_inputs?.join(", ") || "none"}\nRecent runs:\n${summary}\n\nGenerate 3 specific improvements. Return ONLY JSON array:\n[{"title":"...","description":"plain English: what to add/change and exactly how it improves results","action":"upload|configure|edit","impact":"high|medium"}]` }], "", 500);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed)) setImprovements(parsed);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { if (runs.length > 0 && !improvements) generate(); }, [runs.length]);

  if (runs.length === 0) return (
    <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
      <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.muted, lineHeight: 1.7 }}>Run your agent first.<br />Improvement suggestions are generated from actual run patterns.</div>
    </div>
  );
  if (loading) return <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1.5rem 0" }}><span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem" }}>○</span><span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.gold }}>Analyzing your runs...</span></div>;
  if (!improvements) return null;

  const ic = { high: C.success, medium: C.gold };
  return (
    <div>
      {/* Blueprint summary */}
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", padding: "0.85rem 1rem", marginBottom: "1rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>AGENT DEFINITION</div>
        {[
          { label: "Does", value: blueprint?.concept },
          { label: "Reads", value: blueprint?.runtime_inputs },
          { label: "Produces", value: blueprint?.output_description || (blueprint?.output_is_form ? "Completed form" : null) },
          { label: "Form fields", value: blueprint?.template_fields?.length > 0 ? blueprint.template_fields.slice(0, 6).join(", ") + (blueprint.template_fields.length > 6 ? "..." : "") : null },
          { label: "You provide", value: blueprint?.required_user_inputs?.length > 0 ? blueprint.required_user_inputs.join(", ") : null },
        ].filter(r => r.value).map((r, i) => (
          <div key={i} style={{ display: "flex", gap: "0.6rem", marginBottom: "0.25rem" }}>
            <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, flexShrink: 0, minWidth: "70px", marginTop: "2px" }}>{r.label}</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.muted, lineHeight: 1.55 }}>{r.value}</span>
          </div>
        ))}
      </div>

      <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.75rem" }}>IMPROVEMENT QUEUE</div>
      {improvements.map((imp, i) => (
        <div key={i} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", padding: "0.85rem 1rem", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, fontWeight: 600, lineHeight: 1.4, flex: 1, paddingRight: "0.5rem" }}>{imp.title}</div>
            <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: ic[imp.impact] || C.muted, background: (ic[imp.impact] || C.muted) + "22", padding: "0.1rem 0.5rem", borderRadius: "4px", flexShrink: 0 }}>{imp.impact} impact</span>
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

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function AgentDashboard({ agentData, onBack }) {
  const [phase, setPhase] = useState("launching");
  const [blueprint, setBlueprint] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState("");

  const [activeTab, setActiveTab] = useState("run");
  const [runs, setRuns] = useState([]);
  const [freeRunsUsed, setFreeRunsUsed] = useState(0);
  const FREE_LIMIT = 1;

  const [running, setRunning] = useState(false);
  const [currentResult, setCurrentResult] = useState(null);
  const [runError, setRunError] = useState("");

  // File input
  const [inputFile, setInputFile] = useState(null);
  const [inputText, setInputText] = useState("");
  const [fileB64, setFileB64] = useState(null);
  const [fileType, setFileType] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // User-provided fields (GL account, project number, etc.)
  const [userFieldValues, setUserFieldValues] = useState({});

  const [showStripeGate, setShowStripeGate] = useState(false);

  const onLaunched = useCallback((bp, sp) => {
    setBlueprint(bp);
    setSystemPrompt(sp);
    setPhase("live");
  }, []);

  const handleFile = async (file) => {
    setInputFile(file);
    setFileType(file.type);
    setCurrentResult(null);
    setRunError("");
    try {
      const content = await readFileAsText(file);
      if (file.type === "application/pdf") {
        setFileB64(content.split(",")[1]);
        setInputText("[PDF: " + file.name + "]");
      } else {
        setFileB64(null);
        setInputText(content.substring(0, 6000));
      }
    } catch (e) { setRunError("Could not read file: " + e.message); }
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const runAgent = async () => {
    if (!inputText.trim() && !fileB64) return;
    if (freeRunsUsed >= FREE_LIMIT) { setShowStripeGate(true); return; }

    setRunning(true); setRunError(""); setCurrentResult(null);
    const t0 = Date.now();

    try {
      const sys = systemPrompt || buildSystemPrompt(blueprint);

      // Add user-provided fields to the context
      const requiredFields = blueprint?.required_user_inputs || [];
      const userContext = requiredFields.length > 0 && Object.keys(userFieldValues).length > 0
        ? "\n\nUSER-PROVIDED FIELDS FOR THIS RUN:\n" + requiredFields.map(f => `${f}: ${userFieldValues[f] || "(not provided)"}`).join("\n")
        : "";

      let messages;
      if (fileB64 && fileType === "application/pdf") {
        messages = [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileB64 } },
          { type: "text", text: "Process this document according to your specification." + userContext + "\n\nReturn JSON only." }
        ]}];
      } else {
        messages = [{ role: "user", content: "Process this input:\n\n" + inputText.trim() + userContext + "\n\nReturn JSON only." }];
      }

      const raw = await callClaude(messages, sys, 1500);
      const parsed = parseJSON(raw);
      const dur = Date.now() - t0;

      if (parsed) {
        const run = {
          id: uuid(), ts: Date.now(),
          inputName: inputFile?.name || "Pasted input",
          result: parsed, duration: dur,
          tokens: Math.round(dur * 0.4),
          flags: [...(parsed.flags || []), ...(parsed.missing_fields?.length > 0 ? ["Missing fields: " + parsed.missing_fields.join(", ")] : [])],
          isFree: freeRunsUsed < FREE_LIMIT,
        };
        setCurrentResult(parsed);
        setRuns(p => [run, ...p]);
        setFreeRunsUsed(p => p + 1);
      } else {
        setRunError("Could not parse output. Try again.");
      }
    } catch (e) { setRunError("Run failed: " + e.message); }
    setRunning(false);
  };

  const clearRun = () => { setCurrentResult(null); setInputFile(null); setInputText(""); setFileB64(null); setFileType(""); setRunError(""); };

  if (phase === "launching") return <LaunchScreen agentData={agentData} onLaunched={onLaunched} />;
  if (!blueprint) return null;

  const agentName = blueprint.agent_name;
  const isForm = blueprint.output_is_form;
  const totalRuns = runs.length;
  const successRate = totalRuns > 0 ? Math.round(runs.filter(r => !r.flags?.length).length / totalRuns * 100) : 100;
  const avgDur = totalRuns > 0 ? Math.round(runs.reduce((a, r) => a + r.duration, 0) / totalRuns) : 0;
  const avgCost = totalRuns > 0 ? runs.reduce((a, r) => a + r.tokens, 0) / totalRuns : 0;
  const requiredUserFields = blueprint.required_user_inputs || [];

  // Contextual upload label based on what the agent reads
  const uploadLabel = isForm
    ? "Drop your vendor quote here or tap to upload"
    : "Drop your " + (blueprint.runtime_inputs || "document") + " here or tap to upload";
  const uploadSub = isForm
    ? "PDF, Excel, or Word — any vendor quote format works"
    : "PDF, TXT, CSV, Excel, Word";

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, fontFamily: "'Syne', sans-serif", display: "flex", flexDirection: "column", zIndex: 1000 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes spin{to{transform:rotate(360deg)}} @keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} @keyframes live{0%{box-shadow:0 0 0 0 #22C55E55}100%{box-shadow:0 0 0 8px transparent}} .fadein{animation:fadein 0.25s ease} .dz:hover{border-color:#F97316!important} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#1A2535;border-radius:2px}`}</style>

      {/* Header */}
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
          {freeRunsUsed >= FREE_LIMIT ? <span style={{ color: C.accent }}>Subscribe to run →</span> : <span>{FREE_LIMIT - freeRunsUsed} free run remaining</span>}
        </div>
      </div>

      {/* Stats */}
      {totalRuns > 0 && (
        <div style={{ display: "flex", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
          {[{ label: "RUNS", value: totalRuns }, { label: "SUCCESS", value: successRate + "%" }, { label: "AVG TIME", value: fmtDuration(avgDur) }, { label: "AVG COST", value: fmtCost(avgCost) }].map((s, i) => (
            <div key={i} style={{ flex: 1, padding: "0.55rem 0.75rem", textAlign: "center", borderRight: i < 3 ? "1px solid " + C.border : "none" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.15rem" }}>{s.label}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: C.text, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
        {["run", "history", "improve"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "none", borderBottom: "2px solid " + (activeTab === tab ? C.accent : "transparent"), color: activeTab === tab ? C.text : C.muted, fontFamily: "monospace", fontSize: "0.6rem", fontWeight: activeTab === tab ? 700 : 400, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {tab === "history" && totalRuns > 0 ? `History (${totalRuns})` : tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>

        {/* RUN TAB */}
        {activeTab === "run" && (
          <div className="fadein">
            {!currentResult ? (
              <>
                {/* Agent description chip */}
                {blueprint.concept && (
                  <div style={{ background: C.dim, border: "1px solid " + C.border, borderRadius: "8px", padding: "0.55rem 0.75rem", marginBottom: "0.75rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted, letterSpacing: "0.07em", marginBottom: "0.15rem" }}>WHAT THIS AGENT DOES</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.text, lineHeight: 1.6 }}>{blueprint.concept}</div>
                    {isForm && blueprint.template_fields.length > 0 && (
                      <div style={{ marginTop: "0.35rem" }}>
                        <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted, marginBottom: "0.2rem" }}>FILLS THESE FIELDS:</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                          {blueprint.template_fields.slice(0, 8).map((f, i) => (
                            <span key={i} style={{ background: C.success + "22", border: "1px solid " + C.success + "33", borderRadius: "4px", padding: "0.1rem 0.35rem", fontFamily: "monospace", fontSize: "0.46rem", color: C.success }}>{f}</span>
                          ))}
                          {blueprint.template_fields.length > 8 && <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.muted }}>+{blueprint.template_fields.length - 8} more</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* User-provided fields inputs */}
                <PreRunInputs
                  fields={requiredUserFields}
                  values={userFieldValues}
                  onChange={(field, value) => setUserFieldValues(p => ({ ...p, [field]: value }))}
                />

                {/* File drop */}
                <div className="dz" onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileRef.current.click()}
                  style={{ border: "1px dashed " + (dragOver ? C.accent : C.border), borderRadius: "10px", padding: "1.25rem 1rem", background: dragOver ? C.dim : C.card, cursor: "pointer", marginBottom: "0.65rem", display: "flex", alignItems: "center", gap: "0.75rem", transition: "all 0.2s" }}>
                  <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>+</span>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: inputFile ? C.text : C.muted }}>{inputFile ? inputFile.name : uploadLabel}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>{uploadSub}</div>
                  </div>
                </div>
                <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />

                <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, textAlign: "center", marginBottom: "0.5rem" }}>OR PASTE CONTENT</div>
                <textarea value={fileB64 ? "" : inputText} onChange={e => { setInputText(e.target.value); setFileB64(null); setInputFile(null); }}
                  placeholder={"Paste the vendor quote content, or any text your agent should process..."}
                  rows={4} style={{ width: "100%", background: C.card, border: "1px solid " + (inputText && !fileB64 ? C.accent + "55" : C.border), borderRadius: "10px", padding: "0.8rem", color: C.text, fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.65, resize: "none", marginBottom: "0.75rem" }} />

                {runError && <div style={{ background: C.error + "15", border: "1px solid " + C.error + "44", borderRadius: "7px", padding: "0.55rem 0.75rem", marginBottom: "0.65rem" }}><div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.error }}>{runError}</div></div>}

                <button onClick={runAgent} disabled={running || (!inputText.trim() && !fileB64)}
                  style={{ width: "100%", background: running || (!inputText.trim() && !fileB64) ? C.dim : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "10px", padding: "0.85rem", color: running || (!inputText.trim() && !fileB64) ? C.muted : "#000", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: running || (!inputText.trim() && !fileB64) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  {running ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>○</span> Running {agentName}...</> : freeRunsUsed >= FREE_LIMIT ? "SUBSCRIBE TO RUN AGAIN →" : "RUN " + agentName.toUpperCase() + " →"}
                </button>
                {freeRunsUsed < FREE_LIMIT && <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, textAlign: "center", marginTop: "0.5rem" }}>This is your free run. Unlimited runs from $199/month after.</div>}
              </>
            ) : (
              <div className="fadein">
                <OutputDisplay result={currentResult} blueprint={blueprint} compact={false} />
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
                  <button onClick={clearRun} style={{ flex: 1, background: C.dim, border: "1px solid " + C.border, borderRadius: "8px", padding: "0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>Run again</button>
                  <button onClick={() => {
                    const blob = new Blob([JSON.stringify(currentResult, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
                    a.download = agentName.replace(/\s+/g, "_") + "_output.json"; a.click();
                  }} style={{ flex: 1, background: "transparent", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.6rem", color: C.success, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>↓ Download output</button>
                </div>
                {freeRunsUsed >= FREE_LIMIT && (
                  <div style={{ marginTop: "0.85rem", background: C.accent + "0D", border: "1px solid " + C.accent + "33", borderRadius: "10px", padding: "0.85rem 1rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>FREE RUN COMPLETE</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.text, lineHeight: 1.6, marginBottom: "0.65rem" }}>Your agent works. Subscribe to keep it running, monitored, and improving.</div>
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
              : runs.map((run, i) => <RunCard key={run.id} run={run} index={runs.length - 1 - i} blueprint={blueprint} />)
            }
          </div>
        )}

        {activeTab === "improve" && (
          <div className="fadein">
            <ImproveTab blueprint={blueprint} runs={runs} />
          </div>
        )}
      </div>

      {showStripeGate && <StripeGate agentName={agentName} onClose={() => setShowStripeGate(false)} />}
    </div>
  );
}
