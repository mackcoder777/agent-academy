import { useState, useRef, useEffect } from "react";

const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
  purple: "#A78BFA", error: "#EF4444",
};

// ─── API ──────────────────────────────────────────────────────────────────────
const callClaude = async (messages, system, max_tokens = 700) => {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens, messages, ...(system ? { system } : {}) }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const d = await res.json();
  return (d.content || []).map(b => b.text || "").join("");
};

const parseJSON = (t) => {
  const s = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/[\[{][\s\S]*[\]}]/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
};

const readFile = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = e => res(e.target.result);
  r.onerror = rej;
  file.type === "application/pdf" ? r.readAsDataURL(file) : r.readAsText(file);
});

// ─── DOMAIN CONTEXT ───────────────────────────────────────────────────────────
const getDomainCtx = (t) => {
  const l = (t || "").toLowerCase();
  if (l.includes("material request") || l.includes("purchase order") || l.includes("mr form") ||
    (l.includes("fill") && l.includes("form")) || (l.includes("vendor") && l.includes("form")))
    return "DOMAIN: Reads a VENDOR QUOTE → fills a company MATERIAL REQUEST or PO FORM. Quote is the input. The form is the output. They are different documents. The agent maps quote fields (item, qty, unit price) to the form's fields automatically once it has the form. Do not ask about field mapping — it's automatic. Do not ask about OCR — it handles any PDF. Do not invent edge cases not mentioned by the user.";
  if (l.includes("submittal log") || l.includes("submittal register"))
    return "DOMAIN: Reads spec PDFs → produces a submittal log. Input = spec docs. Output = the log. Approved products → structured lookup tables. Do not suggest submittals as inputs.";
  if (l.includes("rfi") || (l.includes("change order") && l.includes("construction")))
    return "DOMAIN: Reads RFI documents + contract terms → produces impact memos or notice letters. Contract is standing context, not runtime input.";
  if ((l.includes("invoice") || l.includes("bill")) && (l.includes("extract") || l.includes("process") || l.includes("approv")))
    return "DOMAIN: Reads invoice PDFs → produces structured records, approval requests, or accounting entries.";
  if (l.includes("contract review") || l.includes("contract analysis"))
    return "DOMAIN: Reads contract documents → produces risk summaries, redlines, or clause extractions. Does not modify the original.";
  if (l.includes("expense") && (l.includes("report") || l.includes("approv")))
    return "DOMAIN: Reads receipts/statements → produces categorized expense reports or approval requests.";
  if (l.includes("resume") || (l.includes("cv") && l.includes("screen")))
    return "DOMAIN: Reads resumes + job description → produces ranked shortlists or fit scores. Job description is standing context.";
  if (l.includes("proposal") && (l.includes("generat") || l.includes("creat") || l.includes("draft")))
    return "DOMAIN: Reads deal data + client requirements → produces formatted proposal documents.";
  if ((l.includes("email") || l.includes("inbox")) && (l.includes("draft") || l.includes("reply") || l.includes("triage")))
    return "DOMAIN: Reads incoming emails → produces draft replies or triage decisions. Never sends without human approval.";
  if (l.includes("lease") && (l.includes("abstract") || l.includes("review")))
    return "DOMAIN: Reads lease documents → produces structured summaries of key terms.";
  if (l.includes("ticket") && (l.includes("triage") || l.includes("classif") || l.includes("route")))
    return "DOMAIN: Reads support tickets → produces classified, prioritized, routed assignments. Does not resolve tickets.";
  if (l.includes("research") && (l.includes("report") || l.includes("summary") || l.includes("brief")))
    return "DOMAIN: Reads sources/databases → produces synthesized reports or summaries.";
  return "";
};

const isFormFilling = (t) => {
  const l = (t || "").toLowerCase();
  return l.includes("fill") || l.includes("fills out") || l.includes("populate") ||
    l.includes("material request") || l.includes("purchase order") ||
    (l.includes("vendor") && l.includes("form"));
};

// ─── TEMPLATE ANALYSIS ────────────────────────────────────────────────────────
const analyzeTemplate = async (file, onResult, onDone) => {
  try {
    const content = await readFile(file);
    let msgs;
    if (file.type === "application/pdf") {
      msgs = [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: content.split(",")[1] } },
        { type: "text", text: `Analyze this form/template that an AI agent will fill out. Return ONLY JSON:\n{"fields":["field1","field2",...],"required_user_inputs":["fields the user must supply that won't come from vendor quotes, like project number, GL account, requested by"],"auto_fillable":["fields that can be extracted from vendor quotes automatically, like item description, qty, unit price"],"summary":"one sentence: what this form is for","file_format":"excel|pdf|word|csv"}` }
      ]}];
    } else {
      msgs = [{ role: "user", content: `This is a form an AI agent will fill out:\n\n${content.substring(0, 4000)}\n\nReturn ONLY JSON:\n{"fields":["field1","field2",...],"required_user_inputs":["fields user must supply that won't come from source docs, like project number, GL account, cost center, requested by"],"auto_fillable":["fields extractable from source docs automatically"],"summary":"one sentence: what this form is for","file_format":"excel|pdf|word|csv"}` }];
    }
    const raw = await callClaude(msgs, "", 600);
    const result = parseJSON(raw);
    if (result) onResult(result);
  } catch (e) { console.error("Template analysis failed:", e); }
  onDone();
};

// ─── STEP SEQUENCES ───────────────────────────────────────────────────────────
const stepsForType = (type) => {
  if (type === "form_filling") return ["concept", "name"]; // template captured at interpret screen
  if (type === "classifier" || type === "researcher") return ["concept", "inputs", "outputs", "name"];
  if (type === "drafter") return ["concept", "inputs", "outputs", "standing_context", "name"];
  return ["concept", "inputs", "outputs", "template", "name"]; // document_processor default
};

// ─── STATIC FALLBACKS ─────────────────────────────────────────────────────────
const fallbackHints = (stepKey, workflowType) => {
  if (workflowType === "form_filling") {
    // Template is already captured — very little to ask here
    return [];
  }
  const m = {
    inputs: [
      { gap: "File type not specified", why: "An agent that expects PDFs but receives Excel files will stop working on every run.", options: ["PDF documents uploaded manually each run", "Excel or CSV files from a shared folder", "email attachments of a specific type"], notRelevant: false },
      { gap: "Run-time metadata missing", why: "Without context like project name or date, the agent can't label its output correctly.", options: ["the project name and responsible party", "the date range or version number", "the vendor or supplier name"], notRelevant: false },
    ],
    outputs: [
      { gap: "Output format not specific enough", why: "Vague output format means the structure changes every run — you can't build a repeatable process on that.", options: ["a filled-out form matching our company template exactly", "a PDF formatted for sharing externally", "a structured spreadsheet with specific columns"], notRelevant: false },
    ],
    concept: [
      { gap: "What triggers it to run?", why: "Without a trigger, we can't deploy this as an agent.", options: ["when I manually upload a file", "on a scheduled basis", "when a file arrives in a folder"], notRelevant: false },
    ],
  };
  return m[stepKey] || [];
};

// ─── HINT CARD — with Not Relevant ───────────────────────────────────────────
function HintCard({ hint, index, state, onInject, onDismiss, onDiscuss }) {
  // state: null | "added" | "dismissed"
  if (state === "dismissed") return null;
  if (state === "added") return (
    <div style={{ background: C.success + "08", border: "1px solid " + C.success + "22", borderRadius: "9px", padding: "0.6rem 0.85rem", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{ color: C.success }}>✓</span>
      <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted }}>Added: "{hint._addedValue}"</span>
    </div>
  );

  return (
    <div style={{ background: "#0D1B27", border: "1px solid #1D3246", borderRadius: "9px", padding: "0.75rem 0.85rem", marginBottom: "0.4rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <span style={{ color: C.accent, flexShrink: 0, fontSize: "0.65rem", marginTop: "3px" }}>→</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#D0E4EE", lineHeight: 1.4, marginBottom: "0.25rem", fontWeight: 600 }}>{hint.gap}</div>
          {hint.why && (
            <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: "#5A8898", lineHeight: 1.55, marginBottom: "0.5rem", background: C.dim, borderRadius: "5px", padding: "0.3rem 0.5rem", borderLeft: "2px solid " + C.muted }}>
              {hint.why}
            </div>
          )}
          {hint.options?.length > 0 && (
            <div style={{ marginBottom: "0.4rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.cyan, marginBottom: "0.25rem", letterSpacing: "0.06em" }}>PICK ONE TO ADD:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                {hint.options.map((opt, oi) => (
                  <button key={oi} onClick={() => onInject(index, opt)}
                    style={{ background: "#0A1E2E", border: "1px solid " + C.cyan + "33", borderRadius: "6px", padding: "0.4rem 0.65rem", color: "#A0D4E8", fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", textAlign: "left", lineHeight: 1.5 }}
                    onMouseOver={e => e.currentTarget.style.background = "#0F2A3E"}
                    onMouseOut={e => e.currentTarget.style.background = "#0A1E2E"}
                  >+ {opt}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button onClick={() => onDismiss(index)} style={{ background: "transparent", border: "1px solid #1D3246", borderRadius: "5px", padding: "0.25rem 0.6rem", color: "#506070", fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer" }}>
              Not relevant
            </button>
            <button onClick={() => onDiscuss(hint.gap)} style={{ background: "transparent", border: "1px solid #1D3246", borderRadius: "5px", padding: "0.25rem 0.6rem", color: "#7090A8", fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer" }}>
              Discuss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SUGGESTION CARD ──────────────────────────────────────────────────────────
function SuggestionCard({ suggestion, onUse, onAdjust, onSkip }) {
  const [adjusting, setAdjusting] = useState(false);
  const [fb, setFb] = useState("");
  return (
    <div style={{ background: "#0E1A26", border: "1px solid " + C.gold + "55", borderRadius: "10px", overflow: "hidden", marginBottom: "0.7rem" }}>
      <div style={{ background: C.gold + "18", padding: "0.4rem 0.85rem", borderBottom: "1px solid " + C.gold + "22" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>SUGGESTED FOR YOUR AGENT</span>
      </div>
      <div style={{ padding: "0.75rem 0.85rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: C.text, lineHeight: 1.7, marginBottom: "0.7rem" }}>{suggestion}</div>
        {adjusting ? (
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginBottom: "0.3rem" }}>What's wrong with this?</div>
            <input value={fb} onChange={e => setFb(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && fb.trim()) { onAdjust(fb.trim()); setAdjusting(false); setFb(""); } }}
              placeholder="e.g. We also receive Excel files, not just PDFs..."
              style={{ width: "100%", background: C.code, border: "1px solid " + C.gold + "44", borderRadius: "6px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", outline: "none", marginBottom: "0.4rem" }} />
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button onClick={() => { if (fb.trim()) { onAdjust(fb.trim()); setAdjusting(false); setFb(""); } }} disabled={!fb.trim()}
                style={{ flex: 1, background: fb.trim() ? C.gold : C.dim, border: "none", borderRadius: "6px", padding: "0.38rem", color: fb.trim() ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: fb.trim() ? "pointer" : "not-allowed" }}>Regenerate</button>
              <button onClick={() => { setAdjusting(false); setFb(""); }} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.38rem 0.65rem", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem" }}>
            <button onClick={onUse} style={{ background: "linear-gradient(135deg," + C.gold + ",#D97706)", border: "none", borderRadius: "7px", padding: "0.5rem", color: "#000", fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: "pointer", gridColumn: "1 / -1" }}>Use This</button>
            <button onClick={() => setAdjusting(true)} style={{ background: "transparent", border: "1px solid " + C.gold + "55", borderRadius: "7px", padding: "0.42rem", color: C.gold, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer" }}>Adjust</button>
            <button onClick={onSkip} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "7px", padding: "0.42rem", color: C.muted, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer" }}>Skip</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CHAT BOX ─────────────────────────────────────────────────────────────────
function ChatBox({ open, onToggle, history, onSend, loading, solution, onInjectSolution, onDiscardSolution }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, loading]);

  return !open ? (
    <button onClick={onToggle} style={{ width: "100%", background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.55rem 0.85rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{ color: C.cyan }}>?</span><span>Not sure what this means? Ask me anything.</span>
    </button>
  ) : (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: C.dim, padding: "0.4rem 0.7rem", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>Assistant — knows your full agent</span>
        <button onClick={onToggle} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "1rem" }}>×</button>
      </div>
      <div style={{ maxHeight: "180px", overflowY: "auto", padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {history.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ background: m.role === "user" ? C.accent : C.dim, color: m.role === "user" ? "#000" : C.text, borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", padding: "0.45rem 0.6rem", fontFamily: "monospace", fontSize: "0.63rem", lineHeight: 1.6, maxWidth: "88%" }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ display: "flex" }}><div style={{ background: C.dim, borderRadius: "10px 10px 10px 2px", padding: "0.45rem 0.6rem", fontFamily: "monospace", fontSize: "0.6rem", color: C.muted }}>Thinking...</div></div>}
        <div ref={endRef} />
      </div>
      {solution && (
        <div style={{ background: C.success + "0F", borderTop: "1px solid " + C.success + "33", padding: "0.6rem 0.7rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>SOLUTION — READY TO ADD</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text, lineHeight: 1.5, marginBottom: "0.4rem" }}>"{solution}"</div>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <button onClick={onInjectSolution} style={{ flex: 1, background: C.success, border: "none", borderRadius: "5px", padding: "0.38rem 0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: "pointer" }}>+ Add to my description</button>
            <button onClick={onDiscardSolution} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.38rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>Discard</button>
          </div>
        </div>
      )}
      <div style={{ padding: "0.4rem 0.5rem", borderTop: "1px solid " + C.border, display: "flex", gap: "0.3rem" }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && input.trim()) { onSend(input.trim()); setInput(""); } }} placeholder="Ask anything..." style={{ flex: 1, background: C.bg, border: "1px solid " + C.dim, borderRadius: "6px", padding: "0.38rem 0.5rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", outline: "none" }} />
        <button onClick={() => { if (input.trim()) { onSend(input.trim()); setInput(""); } }} disabled={!input.trim() || loading} style={{ background: input.trim() ? C.accent : C.dim, border: "none", borderRadius: "6px", padding: "0.38rem 0.65rem", color: input.trim() ? "#000" : C.muted, fontFamily: "monospace", fontWeight: 700, cursor: input.trim() ? "pointer" : "not-allowed" }}>→</button>
      </div>
    </div>
  );
}

// ─── STANDING CONTEXT ACCORDION ───────────────────────────────────────────────
const SC_CATS = [
  { key: "contracts", label: "Contracts & Scope", desc: "How it knows what's included vs. what's a change.", ex: "Subcontract, prime contract, SOW" },
  { key: "specs", label: "Specifications", desc: "What materials or methods are required.", ex: "Project specs, addenda, bulletins" },
  { key: "drawings", label: "Drawings & Designs", desc: "What was originally designed.", ex: "Drawing sets, ASIs, design documents" },
  { key: "standards", label: "Company Standards", desc: "How your company does things.", ex: "SOPs, response templates, guidelines" },
  { key: "approved", label: "Approved Lists", desc: "Who you work with and what you use.", ex: "Approved vendors, preferred products" },
  { key: "codes", label: "Codes & Regulations", desc: "Rules the agent must work within.", ex: "OSHA, building codes, local AHJ" },
  { key: "history", label: "Historical Reference", desc: "How similar situations were handled before.", ex: "Past logs, resolved cases, prior decisions" },
];

function StandingContextUI({ uploads, onUpload, onRemove }) {
  const [open, setOpen] = useState({});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {SC_CATS.map(cat => {
        const catFiles = uploads.filter(u => u.category === cat.key);
        return (
          <div key={cat.key} style={{ background: C.card, border: "1px solid " + (catFiles.length ? C.success + "44" : C.border), borderRadius: "8px", overflow: "hidden" }}>
            <div onClick={() => setOpen(p => ({ ...p, [cat.key]: !p[cat.key] }))} style={{ padding: "0.65rem 0.85rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {catFiles.length > 0 && <span style={{ color: C.success }}>✓</span>}
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: C.text, fontWeight: 600 }}>{cat.label}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>{cat.desc}</div>
                </div>
              </div>
              <span style={{ color: C.muted, fontFamily: "monospace" }}>{open[cat.key] ? "▴" : "▾"}</span>
            </div>
            {open[cat.key] && (
              <div style={{ padding: "0.55rem 0.85rem 0.75rem", borderTop: "1px solid " + C.border }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: "#4A6878", marginBottom: "0.5rem" }}>e.g. {cat.ex}</div>
                {catFiles.map((u, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: C.success + "0A", border: "1px solid " + C.success + "33", borderRadius: "5px", padding: "0.35rem 0.6rem", marginBottom: "0.25rem" }}>
                    <span style={{ color: C.success }}>+</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.text, flex: 1 }}>{u.name}</span>
                    <button onClick={() => onRemove(u)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}>×</button>
                  </div>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: C.dim, border: "1px dashed " + C.cyan + "44", borderRadius: "6px", padding: "0.45rem 0.65rem", cursor: "pointer" }}>
                  <span style={{ color: C.cyan }}>+</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.muted }}>Upload for {cat.label}</span>
                  <input type="file" accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.json" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) onUpload(e.target.files[0], cat.key); }} />
                </label>
                <button onClick={() => setOpen(p => ({ ...p, [cat.key]: false }))} style={{ marginTop: "0.5rem", background: "transparent", border: "none", color: "#3A5060", fontFamily: "monospace", fontSize: "0.5rem", cursor: "pointer", padding: 0 }}>
                  I'll add this from my dashboard later →
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── HUMAN GATE TOGGLES ───────────────────────────────────────────────────────
const DEFAULT_GATES = [
  { key: "before_delivery", label: "Before delivering output", desc: "Always show me the completed result before it is saved or sent.", enabled: true },
  { key: "missing_field", label: "When a required field is missing", desc: "Stop and ask if the source document doesn't contain a required field.", enabled: true },
  { key: "low_confidence", label: "When confidence is below 80%", desc: "Flag for review when the agent is uncertain about an extracted value.", enabled: true },
  { key: "external_action", label: "Before any external action", desc: "Pause before sending, submitting, or sharing anything externally.", enabled: false },
];

function GateToggles({ gates, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {gates.map(g => (
        <div key={g.key} style={{ background: C.card, border: "1px solid " + (g.enabled ? C.accent + "44" : C.border), borderRadius: "9px", padding: "0.7rem 0.9rem", display: "flex", alignItems: "flex-start", gap: "0.85rem" }}>
          <button onClick={() => onToggle(g.key)} style={{ width: "36px", height: "20px", borderRadius: "10px", background: g.enabled ? C.accent : C.dim, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", transition: "background 0.2s", marginTop: "2px" }}>
            <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#fff", position: "absolute", top: "3px", left: g.enabled ? "19px" : "3px", transition: "left 0.2s" }} />
          </button>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, fontWeight: 600, marginBottom: "0.15rem" }}>{g.label}</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, lineHeight: 1.5 }}>{g.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BLUEPRINT PANEL ──────────────────────────────────────────────────────────
function BlueprintPanel({ data, currentLabel, workflowLabel }) {
  const rows = [
    { label: "DOES", value: data.concept },
    { label: "READS", value: data.inputs },
    { label: "PRODUCES", value: data.outputs },
    { label: "TEMPLATE", value: data.template },
    { label: "OVERSIGHT", value: data.humanGate },
  ].filter(r => r.value);
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: "0.85rem", background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ padding: "0.38rem 0.65rem", background: C.dim, borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.muted, letterSpacing: "0.08em" }}>AGENT BLUEPRINT SO FAR</span>
        <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.accent }}>{workflowLabel}</span>
      </div>
      <div style={{ padding: "0.5rem 0.65rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
            <span style={{ fontFamily: "monospace", fontSize: "0.43rem", color: C.accent, flexShrink: 0, marginTop: "2px", minWidth: "52px" }}>{r.label}</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.54rem", color: "#5A8898", lineHeight: 1.5 }}>{r.value.length > 80 ? r.value.slice(0, 80) + "..." : r.value}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: "0.5rem", borderTop: "1px solid " + C.dim, paddingTop: "0.25rem" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.43rem", color: C.gold, flexShrink: 0, marginTop: "2px", minWidth: "52px" }}>NOW</span>
          <span style={{ fontFamily: "monospace", fontSize: "0.54rem", color: C.gold + "88", fontStyle: "italic" }}>{currentLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ─── LAUNCH SUMMARY ───────────────────────────────────────────────────────────
function LaunchSummary({ data, cls, standingUploads, gates, templateAnalysis, onLaunch, onBack }) {
  const name = data.name || "My Agent";
  const enabledGates = gates.filter(g => g.enabled).map(g => g.label.toLowerCase());
  const fields = templateAnalysis?.fields || [];
  const userInputFields = templateAnalysis?.required_user_inputs || [];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
      <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "640px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.1em", marginBottom: "0.2rem" }}>REVIEW YOUR AGENT</div>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: C.text }}>{name}</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.5rem" }}>
          <div style={{ background: C.dim, border: "1px solid " + C.border, borderRadius: "10px", padding: "1rem 1.1rem", marginBottom: "1rem" }}>
            {[
              { label: "WHAT IT DOES", value: data.concept },
              { label: "WHAT IT READS", value: data.inputs || (cls?.output_is_form ? "Vendor quote documents you upload each run" : null) },
              { label: "WHAT IT PRODUCES", value: data.outputs || (cls?.output_is_form && data.template ? "Completed " + data.template.split("—")[0].trim() : null) },
              { label: "FORM TEMPLATE", value: data.template || null },
              { label: "FIELDS DETECTED", value: fields.length > 0 ? fields.slice(0, 8).join(", ") + (fields.length > 8 ? " + " + (fields.length - 8) + " more" : "") : null },
              { label: "STANDING CONTEXT", value: standingUploads.length > 0 ? standingUploads.length + " document(s) uploaded" : "None — add from dashboard after launch" },
              { label: "WHEN IT STOPS", value: enabledGates.length > 0 ? enabledGates.join(", ") : "Runs automatically — you review output" },
            ].filter(r => r.value).map((r, i, arr) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: "0.55rem", paddingBottom: "0.55rem", borderBottom: i < arr.length - 1 ? "1px solid " + C.border : "none" }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, flexShrink: 0, minWidth: "110px", marginTop: "2px", letterSpacing: "0.06em" }}>{r.label}</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text, lineHeight: 1.6 }}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* User-required fields warning */}
          {userInputFields.length > 0 && (
            <div style={{ background: C.gold + "0D", border: "1px solid " + C.gold + "33", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.35rem" }}>FIELDS YOU'LL PROVIDE EACH RUN</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, lineHeight: 1.65, marginBottom: "0.3rem" }}>These fields can't come from vendor quotes automatically — you'll enter them when you run the agent:</div>
              {userInputFields.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.15rem" }}>
                  <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem" }}>·</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: "#C0A040" }}>{f}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: C.accent + "0D", border: "1px solid " + C.accent + "33", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>YOUR FIRST RUN IS FREE</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, lineHeight: 1.6 }}>After that, $199/month keeps it running, monitored, and improving.</div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={onBack} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 1rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer" }}>← Back</button>
            <button onClick={onLaunch} style={{ flex: 1, background: "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "8px", padding: "0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}>
              LAUNCH {name.toUpperCase()} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BLUEPRINT COMPLETE ───────────────────────────────────────────────────────
function BlueprintComplete({ data, cls, standingUploads, gates, templateAnalysis, onRestart, onComplete }) {
  const [copied, setCopied] = useState(false);
  const buildJSON = () => ({
    agent_id: "agent_" + Date.now(),
    agent_name: data.name || "My Agent",
    industry: cls?.industry || "general",
    workflow_type: cls?.workflow_type || "document_processor",
    complexity: cls?.complexity || "medium",
    concept: data.concept,
    trigger: { type: "manual_upload" },
    runtime_inputs: data.inputs || (cls?.output_is_form ? "Vendor quote documents (PDF, Excel)" : ""),
    output: {
      description: data.outputs || (cls?.output_is_form && data.template ? "Completed " + data.template.split("—")[0].trim() : ""),
      template: data.template || null,
      template_fields: templateAnalysis?.fields || [],
      auto_fillable_fields: templateAnalysis?.auto_fillable || [],
      required_user_inputs: templateAnalysis?.required_user_inputs || [],
    },
    standing_context: standingUploads.map(u => ({ name: u.name, category: u.category })),
    human_gates: gates.filter(g => g.enabled).map(g => ({ trigger: g.key, label: g.label, action: "pause_and_notify" })),
    system_prompt: {
      role: "You are " + (data.name || "a specialized AI agent") + ". " + (data.concept || ""),
      constraints: ["Use actual values from inputs — never placeholders", "Log confidence score with every output", "Classify every failure — TRANSIENT, HARD, AMBIGUOUS, or LOGIC"],
    },
    failure_handling: { unreadable_document: "pause_and_notify", missing_required_field: "flag_and_continue", low_confidence: "include_score_and_flag" },
    observability: { log_every_run: true, log_fields: ["input_hash", "confidence", "duration_ms", "token_cost", "human_gate_triggered", "fields_filled", "fields_missing"] },
    pricing: { free_runs: 1 },
    deployment: { infrastructure: "railway", runtime: "python_3.11", framework: "anthropic_sdk" },
  });
  const bp = JSON.stringify(buildJSON(), null, 2);
  const prompt = `Build a production AI agent from this blueprint. Python 3.11 + Anthropic SDK.\n\nBUILD ORDER:\n1. Supabase state schema for agent runs\n2. Document ingestion: chunk + embed all standing_context with pgvector\n3. Core agent loop: perceive → retrieve → decide → act → observe\n4. Tool contracts: one function per external action, idempotent\n5. System prompt from blueprint.system_prompt\n6. Human gate handlers from blueprint.human_gates\n7. Failure handlers from blueprint.failure_handling\n8. Output formatter matching blueprint.output.template_fields — map auto_fillable_fields from source doc, prompt user for required_user_inputs\n9. Observability: log all fields in blueprint.observability.log_fields\n10. Entry point: agent.py accepting file upload + required_user_inputs, running full loop\n\nCONSTRAINTS:\n- All state persisted to Supabase before returning\n- All runs logged to agent_runs table\n- Human gates = async pauses with webhook callback\n- No hardcoded secrets — all from environment variables\n- Retry transient failures 3 times before notifying\n- No silent failures\n\nBLUEPRINT:\n${bp}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
      <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "700px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.1em", marginBottom: "0.15rem" }}>✓ BLUEPRINT COMPLETE</div>
            <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.text }}>{data.name || "Your Agent"} is ready to build.</div>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }}
            style={{ background: copied ? C.success : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "7px", padding: "0.5rem 0.9rem", color: copied ? "#fff" : "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>
            {copied ? "✓ COPIED" : "COPY FOR CLAUDE CODE"}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted, marginBottom: "0.4rem", letterSpacing: "0.07em" }}>DEPLOYABLE AGENT JSON</div>
          <pre style={{ background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", padding: "1rem", fontFamily: "monospace", fontSize: "0.58rem", color: "#B0D4E0", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: "0 0 1rem", overflowX: "auto" }}>{bp}</pre>
          <div style={{ background: C.dim, border: "1px solid " + C.gold + "33", borderRadius: "8px", padding: "0.85rem 1rem", marginBottom: "0.75rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.gold, marginBottom: "0.4rem", letterSpacing: "0.07em" }}>NEXT STEPS</div>
            {["Copy the blueprint above and open Claude Code", "Paste: Build a production agent from this blueprint", "Claude Code builds your agent with state, tools, failure handling, and observability", "Come back to Agent Academy to monitor and improve it"].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem", flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: "#A0B8C8", lineHeight: 1.55 }}>{s}</span>
              </div>
            ))}
          </div>
          <button onClick={onRestart} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.55rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", width: "100%" }}>
            Start over with a different agent
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── INTERPRET SCREEN ─────────────────────────────────────────────────────────
// This is the key new screen. Plain text → Claude interprets → user confirms.
// For form-filling agents: form upload happens HERE before any coaching.
function InterpretScreen({ rawText, classification, onConfirmed, onBack }) {
  const isForm = classification?.output_is_form || classification?.workflow_type === "form_filling";
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const [reclassifying, setReclassifying] = useState(false);
  const [cls, setCls] = useState(classification);

  // Template state — captured here for form-filling agents
  const [templateFile, setTemplateFile] = useState(null);
  const [templateAnalysis, setTemplateAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef(null);

  const handleCorrect = async () => {
    if (!correction.trim()) return;
    setReclassifying(true);
    try {
      const domainCtx = getDomainCtx(correction);
      const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}User wants to automate: "${correction}"\n\nClassify. Return ONLY JSON:\n{"industry":"construction|legal|finance|hr|sales|support|healthcare|general","workflow_type":"form_filling|document_processor|classifier|drafter|researcher","complexity":"simple|medium|complex","output_is_form":true|false,"plain_english":"In plain English: this agent [reads X] and [produces Y]. [One more sentence about how it helps the user.]"}` }], "", 400);
      const parsed = parseJSON(raw);
      if (parsed) {
        parsed.required_steps = stepsForType(parsed.workflow_type);
        setCls(parsed);
      }
    } catch (e) {}
    setCorrecting(false);
    setCorrection("");
    setReclassifying(false);
  };

  const handleFileUpload = async (file) => {
    setTemplateFile(file);
    setAnalyzing(true);
    await analyzeTemplate(file, (result) => {
      setTemplateAnalysis(result);
    }, () => setAnalyzing(false));
  };

  const canProceed = !isForm || templateFile; // form-filling requires a template
  const understanding = cls?.plain_english || cls?.understanding || "";

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "640px" }}>
        {/* What we're building */}
        <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.accent, letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
          AGENT ACADEMY — {(cls?.workflow_type || "").replace(/_/g, " ").toUpperCase()}
        </div>

        <div style={{ background: C.card, border: "1px solid " + C.cyan + "44", borderRadius: "12px", padding: "1.25rem 1.5rem", marginBottom: "1rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>HERE'S WHAT I'M BUILDING FOR YOU</div>
          {correcting ? (
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, marginBottom: "0.4rem" }}>Tell me what you actually want to automate:</div>
              <textarea value={correction} onChange={e => setCorrection(e.target.value)}
                placeholder="e.g. I receive vendor quotes as PDFs and need to transfer the line items into our company's Excel MR form..."
                rows={3} style={{ width: "100%", background: C.dim, border: "1px solid " + C.cyan + "44", borderRadius: "8px", padding: "0.7rem", color: C.text, fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.65, resize: "none", outline: "none", marginBottom: "0.5rem" }} />
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button onClick={handleCorrect} disabled={!correction.trim() || reclassifying}
                  style={{ flex: 1, background: correction.trim() ? C.cyan : C.dim, border: "none", borderRadius: "7px", padding: "0.55rem", color: correction.trim() ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.62rem", fontWeight: 700, cursor: correction.trim() ? "pointer" : "not-allowed" }}>
                  {reclassifying ? "Updating..." : "Update →"}
                </button>
                <button onClick={() => { setCorrecting(false); setCorrection(""); }} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "7px", padding: "0.55rem 0.85rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "1.05rem", color: C.text, lineHeight: 1.7, marginBottom: "0.75rem", fontWeight: 500 }}>
                {understanding || `This agent reads your uploaded documents and produces a formatted output automatically.`}
              </div>
              <button onClick={() => setCorrecting(true)} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.35rem 0.75rem", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>
                That's not quite right →
              </button>
            </div>
          )}
        </div>

        {/* Form upload — for form-filling agents, required BEFORE proceeding */}
        {isForm && !correcting && (
          <div style={{ background: C.card, border: "1px solid " + (templateFile ? C.success + "55" : C.gold + "55"), borderRadius: "12px", padding: "1.25rem 1.5rem", marginBottom: "1rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: templateFile ? C.success : C.gold, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
              {templateFile ? "✓ FORM UPLOADED" : "UPLOAD YOUR COMPANY FORM"}
            </div>
            {!templateFile ? (
              <div>
                <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, lineHeight: 1.65, marginBottom: "0.75rem" }}>
                  Your agent fills out a specific form. Upload it now — the agent reads your exact field names and figures out how to populate them from vendor quotes automatically.
                </div>
                <div onClick={() => fileRef.current.click()} style={{ border: "2px dashed " + C.gold + "66", borderRadius: "10px", padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer", background: C.dim }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: C.gold, marginBottom: "0.25rem" }}>Drop your form here or tap to upload</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted }}>Excel, PDF, Word, or CSV — the actual file</div>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFileUpload(e.target.files[0])} />
                </div>
                <button onClick={() => onConfirmed(rawText, cls, null, null)} style={{ marginTop: "0.65rem", background: "transparent", border: "none", color: C.muted, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer", padding: 0 }}>
                  I don't have the file right now — skip and add from dashboard →
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <span style={{ color: C.success }}>✓</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, flex: 1 }}>{templateFile.name}</span>
                  <button onClick={() => { setTemplateFile(null); setTemplateAnalysis(null); }} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>Remove</button>
                </div>
                {analyzing && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem" }}>○</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.gold }}>Reading your form — learning field structure...</span>
                  </div>
                )}
                {templateAnalysis && !analyzing && (
                  <div style={{ background: C.code, border: "1px solid " + C.success + "33", borderRadius: "8px", padding: "0.65rem 0.85rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>FORM UNDERSTOOD</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#80A890", lineHeight: 1.6, marginBottom: "0.35rem" }}>{templateAnalysis.summary}</div>
                    {templateAnalysis.fields?.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.35rem" }}>
                        {templateAnalysis.fields.slice(0, 12).map((f, i) => (
                          <span key={i} style={{ background: C.success + "22", border: "1px solid " + C.success + "33", borderRadius: "4px", padding: "0.1rem 0.4rem", fontFamily: "monospace", fontSize: "0.47rem", color: C.success }}>{f}</span>
                        ))}
                        {templateAnalysis.fields.length > 12 && <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted }}>+{templateAnalysis.fields.length - 12} more</span>}
                      </div>
                    )}
                    {templateAnalysis.required_user_inputs?.length > 0 && (
                      <div style={{ borderTop: "1px solid " + C.dim, paddingTop: "0.35rem" }}>
                        <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.gold, marginBottom: "0.2rem" }}>YOU'LL PROVIDE THESE EACH RUN (not in vendor quotes):</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#A08030" }}>{templateAnalysis.required_user_inputs.join(", ")}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Proceed button */}
        {!correcting && (
          <button onClick={() => onConfirmed(rawText, cls, templateFile, templateAnalysis)}
            disabled={isForm && !templateFile && !analyzing}
            style={{
              width: "100%",
              background: (isForm && !templateFile) ? C.dim : "linear-gradient(135deg," + C.accent + "," + C.gold + ")",
              border: "none", borderRadius: "10px", padding: "0.9rem",
              color: (isForm && !templateFile) ? C.muted : "#000",
              fontFamily: "monospace", fontSize: "0.72rem", fontWeight: 800,
              cursor: (isForm && !templateFile) ? "not-allowed" : "pointer",
              marginBottom: "0.5rem",
            }}>
            {isForm && !templateFile ? "Upload your form to continue" : analyzing ? "Reading your form..." : "Looks right — build it →"}
          </button>
        )}
        <button onClick={onBack} style={{ width: "100%", background: "transparent", border: "none", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer", padding: "0.3rem" }}>← Back</button>
      </div>
    </div>
  );
}

// ─── PRE-STEP ─────────────────────────────────────────────────────────────────
function PreStep({ onSubmit }) {
  const [val, setVal] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (val.trim().length < 8) return;
    setLoading(true);
    const domainCtx = getDomainCtx(val.trim());
    const isForm = isFormFilling(val.trim());
    try {
      const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}User wants to automate: "${val.trim()}"\n\nClassify and write a plain English interpretation. Return ONLY JSON:\n{"industry":"construction|legal|finance|hr|sales|support|healthcare|general","workflow_type":"form_filling|document_processor|classifier|drafter|researcher","complexity":"simple|medium|complex","output_is_form":${isForm},"plain_english":"In plain English: this agent [reads X the user uploads each time] and [fills out / produces Y]. [One sentence on how it saves time.]"}` }], "", 400);
      const parsed = parseJSON(raw);
      if (parsed?.workflow_type) {
        parsed.required_steps = stepsForType(parsed.workflow_type);
        onSubmit(val.trim(), parsed);
      } else {
        onSubmit(val.trim(), { industry: "general", workflow_type: isForm ? "form_filling" : "document_processor", complexity: "medium", output_is_form: isForm, required_steps: stepsForType(isForm ? "form_filling" : "document_processor"), plain_english: "This agent reads your uploaded documents and produces formatted output automatically." });
      }
    } catch (e) {
      onSubmit(val.trim(), { industry: "general", workflow_type: isForm ? "form_filling" : "document_processor", complexity: "medium", output_is_form: isForm, required_steps: stepsForType(isForm ? "form_filling" : "document_processor"), plain_english: "This agent reads your uploaded documents and produces formatted output automatically." });
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", padding: "1.5rem" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} textarea,input{outline:none}`}</style>
      <div style={{ width: "100%", maxWidth: "640px" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.accent, letterSpacing: "0.1em", marginBottom: "0.5rem" }}>AGENT ACADEMY</div>
        <h1 style={{ fontWeight: 800, fontSize: "clamp(1.8rem, 5vw, 2.8rem)", color: C.text, lineHeight: 1.1, margin: "0 0 0.5rem" }}>What do you want to automate?</h1>
        <p style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.muted, margin: "0 0 1.5rem", lineHeight: 1.6 }}>Describe what you do today and what you wish happened automatically. Plain English is perfect.</p>
        <textarea value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSubmit(); }}
          placeholder="e.g. an agent that fills in company material request forms using uploaded vendor PDFs..." rows={4}
          style={{ width: "100%", background: C.card, border: "1px solid " + (val ? C.accent + "55" : C.border), borderRadius: "12px", padding: "1rem", color: C.text, fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.7, resize: "none", marginBottom: "0.75rem" }} />
        <button onClick={handleSubmit} disabled={loading || val.trim().length < 8}
          style={{ width: "100%", background: loading || val.trim().length < 8 ? C.dim : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "10px", padding: "0.9rem", color: loading || val.trim().length < 8 ? C.muted : "#000", fontFamily: "monospace", fontSize: "0.72rem", fontWeight: 800, cursor: loading || val.trim().length < 8 ? "not-allowed" : "pointer", marginBottom: "0.6rem" }}>
          {loading ? "Interpreting your workflow..." : "Build My Agent →"}
        </button>
        <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, textAlign: "center" }}>Your first run is free. No card required to start.</div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function SmartIntake({ onComplete }) {
  const [screen, setScreen] = useState("pre"); // pre | interpret | steps | launch | blueprint
  const [rawText, setRawText] = useState("");
  const [cls, setCls] = useState(null);
  const [steps, setSteps] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData] = useState({});
  const [suggestions, setSuggestions] = useState({});

  // Coaching
  const [hints, setHints] = useState([]);
  const [hintStates, setHintStates] = useState({}); // index → "added"|"dismissed"|null
  const [hintsLoading, setHintsLoading] = useState(false);
  const [aiUnderstanding, setAiUnderstanding] = useState("");
  const [correctingUnderstanding, setCorrectingUnderstanding] = useState(false);
  const [correctionInput, setCorrectionInput] = useState("");

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSolution, setChatSolution] = useState("");

  // Template (captured at interpret screen for form-filling)
  const [templateFile, setTemplateFile] = useState(null);
  const [templateAnalysis, setTemplateAnalysis] = useState(null);
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);

  // Optional template for non-form agents (captured at template step)
  const [stepTemplateFile, setStepTemplateFile] = useState(null);
  const [stepTemplateAnalysis, setStepTemplateAnalysis] = useState(null);
  const stepTemplateRef = useRef(null);

  // Standing context
  const [standingUploads, setStandingUploads] = useState([]);

  // Human gates
  const [humanGates, setHumanGates] = useState(DEFAULT_GATES);
  const [gatesGenerated, setGatesGenerated] = useState(false);

  const coachTimer = useRef(null);
  const skipNextCoach = useRef(false);
  const correctionRef = useRef("");

  const cur = steps[stepIdx];
  const val = cur ? (data[cur.key] || "") : "";
  const isLast = stepIdx === steps.length - 1;
  const pct = steps.length > 1 ? Math.round((stepIdx / (steps.length - 1)) * 100) : 0;
  const workflowLabel = (cls?.workflow_type || "").replace(/_/g, " ").toUpperCase();

  // Build step definitions
  const buildSteps = (classification, tplAnalysis) => {
    const isForm = classification?.output_is_form || classification?.workflow_type === "form_filling";
    const rs = classification?.required_steps || stepsForType(classification?.workflow_type || "document_processor");

    const defs = {
      concept: {
        key: "concept",
        headline: "Confirm what your agent does.",
        sub: "The description below was pre-filled from what you entered. Edit it to be more specific if needed.",
        placeholder: "e.g. Read vendor quote PDFs and fill out our company Material Request form with all line items, quantities, unit prices, and totals...",
        hint: "The more specific you are, the more consistent the output.",
        // For form-filling with template analyzed: suppress coaching almost entirely
        noCoach: isForm && !!tplAnalysis,
        coachQ: isForm ? null : (val, ctx, correction) => {
          const domainCtx = getDomainCtx(val);
          const corrCtx = correction ? `IMPORTANT: User clarified: "${correction}".\n\n` : "";
          return `${domainCtx ? domainCtx + "\n\n" : ""}${corrCtx}Agent description: "${val}"\n\nReturn JSON:\n{"understanding":"I'm treating this as [specific process]...","hints":[{"gap":"label","why":"what goes wrong without this","options":["A","B","C"]}]}\n\nRULES: Do NOT suggest field mapping, OCR, data validation, approval workflows, or uploading the output template. Do NOT invent edge cases the user didn't mention. Max 2 hints. Options in plain English — no jargon. Return ONLY JSON.`;
        },
      },
      inputs: {
        key: "inputs",
        headline: "What does it read each time you run it?",
        sub: "Every time you give it work, what does it need to look at?",
        placeholder: "e.g. The vendor quote PDF — I upload it manually each time...",
        hint: "This is the new work you hand it each run. Documents it always has access to are set up separately.",
        coachQ: (val, ctx) => {
          const domainCtx = getDomainCtx(data.concept || "");
          return `${domainCtx ? domainCtx + "\n\n" : ""}Agent context:\n${ctx}\n\nInputs described: "${val}"\n\nWhat file type or metadata is missing? Do NOT suggest the output template — it has its own step. Do NOT suggest field mapping or validation. Plain English only. Max 2 hints. Return ONLY JSON array:\n[{"gap":"label","why":"what fails without this","options":["A","B","C"]}]`;
        },
      },
      outputs: {
        key: "outputs",
        headline: "What do you want when it's done?",
        sub: "When it finishes, what exists that didn't before?",
        placeholder: "e.g. A completed Material Request form with all fields filled in, saved as Excel...",
        hint: "Specific beats vague. 'A completed MR form' gives consistent results. 'A document' doesn't.",
        coachQ: (val, ctx) => {
          const domainCtx = getDomainCtx(data.concept || "");
          return `${domainCtx ? domainCtx + "\n\n" : ""}Agent context:\n${ctx}\n\nOutputs described: "${val}"\n\nWhat output details are missing? Do NOT suggest field mapping or approval workflow. Max 2 hints. Return ONLY JSON array:\n[{"gap":"label","why":"what goes wrong","options":["A","B","C"]}]`;
        },
      },
      template: {
        key: "template",
        isTemplate: true, noCoach: true, optional: true,
        headline: "Does it follow a specific output format?",
        sub: "If your company has a standard template or format for this output, upload it. Your agent will follow your exact structure every time.",
      },
      standing_context: {
        key: "standing_context",
        isStandingContext: true, noCoach: true, optional: true,
        headline: "What does it always need access to?",
        sub: "Upload once. Lives in your agent permanently. Available on every run — you never think about it again.",
      },
      humanGate: {
        key: "humanGate",
        isHumanGate: true, optional: true,
        headline: "When should it stop and check with you?",
        sub: "Configure the moments where it pauses and waits for you before proceeding.",
      },
      name: {
        key: "name", headline: "Give it a name.", sub: "What do you want to call this agent?",
        placeholder: "e.g. MR Scout, Quote Parser, Invoice Filler...",
        hint: "Names make agents feel real.", noSuggest: true, noCoach: true,
      },
    };
    return rs.filter(k => defs[k]).map(k => defs[k]);
  };

  // Called when user confirms on the interpret screen
  const handleConfirmed = async (text, classification, tplFile, tplAnalysis) => {
    setTemplateFile(tplFile);
    setTemplateAnalysis(tplAnalysis);
    const builtSteps = buildSteps(classification, tplAnalysis);
    setCls(classification);
    setSteps(builtSteps);

    // Pre-fill concept from plain_english interpretation, or from raw text
    const conceptVal = tplAnalysis
      ? `${text}. Output form: ${tplFile?.name || "uploaded form"} with fields: ${(tplAnalysis.fields || []).slice(0, 6).join(", ")}${(tplAnalysis.fields || []).length > 6 ? "..." : ""}.`
      : text;

    // Set data including template info
    const initData = {
      concept: conceptVal,
      template: tplFile ? tplFile.name + " — " + (tplAnalysis?.summary || "") : "",
    };
    setData(initData);
    setAiUnderstanding(classification?.plain_english || classification?.understanding || "");
    setScreen("steps");
    setStepIdx(0);

    // Generate suggestions for non-template steps
    if (classification?.workflow_type !== "form_filling") {
      try {
        const domainCtx = getDomainCtx(text);
        const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}Agent: "${text}"\nIndustry: ${classification?.industry}\nWorkflow: ${classification?.workflow_type}\n\nGenerate specific, plain English suggestions. Return ONLY JSON:\n{"inputs":"...","outputs":"..."}` }], "", 400);
        const parsed = parseJSON(raw) || {};
        setSuggestions(parsed);
      } catch {}
    }
  };

  // Coaching effect
  useEffect(() => {
    if (!cur || cur.noCoach || val.trim().length < 20) { setHints([]); return; }
    if (skipNextCoach.current) { skipNextCoach.current = false; return; }
    clearTimeout(coachTimer.current);
    coachTimer.current = setTimeout(async () => {
      setHintsLoading(true);
      try {
        const ctx = [
          data.concept && "CONCEPT: " + data.concept,
          data.inputs && "INPUTS: " + data.inputs,
          data.outputs && "OUTPUTS: " + data.outputs,
          data.template && "TEMPLATE: " + data.template,
        ].filter(Boolean).join("\n");

        const resolved = [
          templateFile && "output form already uploaded (" + templateFile.name + ") — do not re-ask",
          data.template && "template/format already defined — do not re-ask",
          data.inputs && "inputs already defined — do not re-ask",
          data.outputs && "outputs already defined — do not re-ask",
        ].filter(Boolean);

        let q;
        if (cur.coachQ) {
          q = cur.coachQ(val, ctx, correctionRef.current);
        } else {
          q = `Agent context:\n${ctx}\n\n${resolved.length ? "ALREADY RESOLVED — do not re-ask: " + resolved.join("; ") + "\n\n" : ""}Current field "${cur.key}": "${val}"\n\nWhat is genuinely missing? Do NOT suggest field mapping, data validation, approval workflow, or anything already resolved. Plain English options only. Return ONLY JSON array:\n[{"gap":"label","why":"what fails without this","options":["A","B","C"]}]`;
        }

        const raw = await callClaude([{ role: "user", content: q }], "", 500);
        const parsed = parseJSON(raw);

        setHintStates({});
        if (parsed && !Array.isArray(parsed) && parsed.hints) {
          if (parsed.understanding && cur.key === "concept") setAiUnderstanding(parsed.understanding);
          const arr = (parsed.hints || []).filter(h => h.gap).slice(0, 3);
          setHints(arr.length ? arr : fallbackHints(cur.key, cls?.workflow_type));
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          setHints(parsed.filter(h => h.gap).slice(0, 3));
        } else {
          setHints(fallbackHints(cur.key, cls?.workflow_type));
        }
      } catch {
        setHints(fallbackHints(cur.key, cls?.workflow_type));
      }
      setHintsLoading(false);
    }, 1200);
    return () => clearTimeout(coachTimer.current);
  }, [val, cur?.key]);

  // Step change — reset state
  useEffect(() => {
    if (!cur) return;
    setHints([]); setHintsLoading(false); setHintStates({});
    setChatOpen(false); setChatHistory([]); setChatSolution("");
    setCorrectingUnderstanding(false); setCorrectionInput("");
    if (cur.key !== "concept") setAiUnderstanding("");
    if (cur.key === "humanGate" && !gatesGenerated) generateGates();
  }, [stepIdx]);

  const generateGates = async () => {
    const ctx = [data.concept && "CONCEPT: " + data.concept, data.outputs && "OUTPUTS: " + data.outputs].filter(Boolean).join("\n");
    try {
      const raw = await callClaude([{ role: "user", content: `Agent context:\n${ctx}\n\nGenerate 4 specific human oversight gate suggestions for this agent. Think about: external actions, silent failure modes, irreversible steps, judgment calls. Return ONLY JSON array:\n[{"key":"snake_key","label":"short label","desc":"one sentence: what the agent pauses to check","enabled":true}]` }], "", 400);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed) && parsed.length > 0) { setHumanGates(parsed); setGatesGenerated(true); }
    } catch {}
  };

  const handleInject = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + (p[cur.key] ? ", " : "") + option }));
    setHintStates(p => ({ ...p, [index]: "added" }));
    setHints(prev => prev.map((h, i) => i === index ? { ...h, _addedValue: option } : h));
  };

  const handleDismiss = (index) => {
    setHintStates(p => ({ ...p, [index]: "dismissed" }));
  };

  const handleDiscuss = (gap) => {
    setChatOpen(true);
    setChatHistory([{ role: "assistant", content: `Let's figure out: "${gap.substring(0, 80)}". How does this apply to your agent specifically?` }]);
  };

  const handleChatSend = async (msg) => {
    setChatLoading(true);
    const hist = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(hist);
    try {
      const ctx = [data.concept, data.inputs, data.outputs, data.template].filter(Boolean).join(" | ");
      const domainCtx = getDomainCtx(data.concept || "");
      const sys = `${domainCtx ? domainCtx + "\n\n" : ""}You help people design AI agents. Agent context: ${ctx}\n\nCurrent step: "${cur?.headline}"\n\nRULES: Stay on current step. When you reach a clear answer, end with: SOLUTION: [one sentence]. Under 80 words. Plain English — no jargon.`;
      const r = await callClaude(hist, sys, 250);
      const match = r.match(/SOLUTION:\s*(.+?)(?:\n|$)/i);
      if (match) { setChatSolution(match[1].trim()); setChatHistory([...hist, { role: "assistant", content: r.replace(/SOLUTION:\s*.+?(?:\n|$)/i, "").trim() }]); }
      else { setChatSolution(""); setChatHistory([...hist, { role: "assistant", content: r }]); }
    } catch { setChatHistory([...hist, { role: "assistant", content: "Connection issue, try again." }]); }
    setChatLoading(false);
  };

  const canProceed = () => {
    if (!cur) return false;
    if (cur.optional || cur.isTemplate || cur.isStandingContext || cur.isHumanGate) return true;
    return val.trim().length > 0;
  };

  const goNext = () => {
    if (!canProceed()) return;
    if (isLast) setScreen("launch");
    else setStepIdx(s => s + 1);
  };
  const goBack = () => { if (stepIdx > 0) setStepIdx(s => s - 1); else setScreen("interpret"); };

  // Render
  if (screen === "pre") return <PreStep onSubmit={(text, classification) => { setRawText(text); setCls(classification); setScreen("interpret"); }} />;

  if (screen === "interpret") return (
    <InterpretScreen rawText={rawText} classification={cls} onConfirmed={handleConfirmed} onBack={() => setScreen("pre")} />
  );

  if (screen === "launch") return (
    <LaunchSummary
      data={data} cls={cls} standingUploads={standingUploads} gates={humanGates} templateAnalysis={templateAnalysis}
      onLaunch={() => {
        if (typeof onComplete === "function") {
          onComplete({
            agentName: data.name || "My Agent",
            concept: data.concept,
            inputs: data.inputs || (cls?.output_is_form ? "Vendor quote documents" : ""),
            outputs: data.outputs || (cls?.output_is_form && data.template ? "Completed " + templateFile?.name : ""),
            template: data.template,
            templateFile, templateAnalysis,
            standingContext: standingUploads.map(u => u.name).join(", "),
            humanGate: humanGates.filter(g => g.enabled).map(g => g.label).join("; "),
            classification: cls,
          });
        }
        setScreen("blueprint");
      }}
      onBack={() => setScreen("steps")}
    />
  );

  if (screen === "blueprint") return (
    <BlueprintComplete
      data={data} cls={cls} standingUploads={standingUploads} gates={humanGates} templateAnalysis={templateAnalysis}
      onRestart={() => { setScreen("pre"); setData({}); setStepIdx(0); setCls(null); setSteps([]); setTemplateFile(null); setTemplateAnalysis(null); setStandingUploads([]); setHumanGates(DEFAULT_GATES); setSuggestions({}); correctionRef.current = ""; setRawText(""); }}
      onComplete={onComplete}
    />
  );

  if (!cur) return null;

  const hasSuggestion = !cur.noSuggest && suggestions[cur.key] && !suggestions[cur.key].startsWith("_");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} .fadein{animation:fadein 0.2s ease} .intake-modal{background:#0B0F16;border:1px solid #182430;width:100%;max-width:560px;border-radius:16px 16px 0 0;border-bottom:none;max-height:94vh;display:flex;flex-direction:column;overflow:hidden} @media(min-width:700px){.intake-outer{align-items:center;padding:2rem}.intake-modal{border-radius:14px;border-bottom:1px solid #182430;max-width:700px;max-height:90vh}}`}</style>

      <div className="intake-outer" style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", width: "100%" }}>
        <div className="intake-modal">

          {/* Header */}
          <div style={{ padding: "0.85rem 1.25rem 0.6rem", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, letterSpacing: "0.1em" }}>{workflowLabel}</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted }}>{pct}%</span>
            </div>
            <div style={{ height: "3px", background: C.dim, borderRadius: "2px", overflow: "hidden", marginBottom: "0.3rem" }}>
              <div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg," + C.accent + "," + C.gold + ")", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              {steps.map((_, i) => <div key={i} style={{ flex: 1, height: "2px", borderRadius: "1px", background: i < stepIdx ? C.accent : i === stepIdx ? C.gold : C.dim, transition: "background 0.3s" }} />)}
            </div>
          </div>

          {/* Body */}
          <div className="fadein" style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.25rem 0.5rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.45rem", margin: "0 0 0.2rem", color: C.text, lineHeight: 1.15 }}>{cur.headline}</h2>
            <p style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.muted, margin: "0 0 0.85rem", lineHeight: 1.6 }}>
              {cur.sub}{cur.optional && <span style={{ color: C.accent }}> — optional</span>}
            </p>

            {/* AI Understanding card (concept step only) */}
            {aiUnderstanding && cur.key === "concept" && (
              <div style={{ background: "#0A1520", border: "1px solid " + C.cyan + "33", borderRadius: "8px", overflow: "hidden", marginBottom: "0.75rem" }}>
                <div style={{ padding: "0.4rem 0.75rem", background: C.cyan + "0D", borderBottom: "1px solid " + C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ color: C.cyan }}>◈</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.cyan, letterSpacing: "0.07em" }}>MY UNDERSTANDING</span>
                  </div>
                  {!correctingUnderstanding && (
                    <button onClick={() => setCorrectingUnderstanding(true)} style={{ background: "transparent", border: "1px solid " + C.cyan + "44", borderRadius: "4px", padding: "0.15rem 0.5rem", color: C.cyan, fontFamily: "monospace", fontSize: "0.48rem", cursor: "pointer" }}>Correct this</button>
                  )}
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.63rem", color: "#90B0C8", lineHeight: 1.6 }}>{aiUnderstanding}</div>
                  {correctingUnderstanding && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <input value={correctionInput} onChange={e => setCorrectionInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && correctionInput.trim()) { correctionRef.current = correctionInput; setCorrectingUnderstanding(false); setCorrectionInput(""); setHints([]); skipNextCoach.current = false; setData(p => ({ ...p, concept: (p.concept || "").trimEnd() + " " })); } }}
                        placeholder="Tell me what this actually means at your company..."
                        style={{ width: "100%", background: C.code, border: "1px solid " + C.cyan + "44", borderRadius: "5px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", marginBottom: "0.35rem" }} />
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button onClick={() => { if (!correctionInput.trim()) return; correctionRef.current = correctionInput; setCorrectingUnderstanding(false); setCorrectionInput(""); setHints([]); skipNextCoach.current = false; setData(p => ({ ...p, concept: (p.concept || "").trimEnd() + " " })); }}
                          style={{ background: C.cyan, border: "none", borderRadius: "5px", padding: "0.35rem 0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>Update</button>
                        <button onClick={() => { setCorrectingUnderstanding(false); setCorrectionInput(""); }} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.35rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Template display (captured at interpret) — shown on concept step for form-filling */}
            {cur.key === "concept" && templateFile && (
              <div style={{ background: C.success + "0A", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.85rem", marginBottom: "0.75rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>✓ FORM UPLOADED</div>
                <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, marginBottom: "0.25rem" }}>{templateFile.name}</div>
                {templateAnalysis?.fields?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                    {templateAnalysis.fields.slice(0, 10).map((f, i) => (
                      <span key={i} style={{ background: C.success + "22", border: "1px solid " + C.success + "33", borderRadius: "4px", padding: "0.1rem 0.35rem", fontFamily: "monospace", fontSize: "0.46rem", color: C.success }}>{f}</span>
                    ))}
                    {templateAnalysis.fields.length > 10 && <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.muted }}>+{templateAnalysis.fields.length - 10} more</span>}
                  </div>
                )}
                {templateAnalysis?.required_user_inputs?.length > 0 && (
                  <div style={{ marginTop: "0.4rem", fontFamily: "monospace", fontSize: "0.52rem", color: C.gold, lineHeight: 1.5 }}>
                    You'll provide each run: {templateAnalysis.required_user_inputs.join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Suggestion */}
            {hasSuggestion && !val && (
              <SuggestionCard
                suggestion={suggestions[cur.key]}
                onUse={() => setData(p => ({ ...p, [cur.key]: suggestions[cur.key] }))}
                onAdjust={async (fb) => {
                  const domainCtx = getDomainCtx(data.concept || "");
                  const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}Agent: "${data.concept}"\nOriginal suggestion for "${cur.key}": "${suggestions[cur.key]}"\nFeedback: "${fb}"\n\nRewrite it. Return plain text only.` }], "", 200);
                  setSuggestions(p => ({ ...p, [cur.key]: raw.trim() }));
                }}
                onSkip={() => setSuggestions(p => ({ ...p, [cur.key]: "_skipped" }))}
              />
            )}

            {/* Main input or special UIs */}
            {cur.isStandingContext ? (
              <StandingContextUI uploads={standingUploads} onUpload={(f, cat) => setStandingUploads(p => [...p, { name: f.name, file: f, category: cat }])} onRemove={(u) => setStandingUploads(p => p.filter(x => x !== u))} />
            ) : cur.isHumanGate ? (
              <GateToggles gates={humanGates} onToggle={(key) => setHumanGates(p => p.map(g => g.key === key ? { ...g, enabled: !g.enabled } : g))} />
            ) : cur.isTemplate ? (
              // Optional template step (non-form-filling agents)
              <div>
                {!stepTemplateFile ? (
                  <div>
                    <div onClick={() => stepTemplateRef.current.click()} style={{ border: "2px dashed " + C.gold + "55", borderRadius: "10px", padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer", background: C.dim, marginBottom: "0.65rem" }}>
                      <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: C.gold, marginBottom: "0.25rem" }}>Upload your template file</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted }}>Excel, PDF, Word, or CSV — agent follows your exact structure every run</div>
                      <input ref={stepTemplateRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }}
                        onChange={e => {
                          const f = e.target.files[0]; if (!f) return;
                          setStepTemplateFile(f);
                          setAnalyzingTemplate(true);
                          analyzeTemplate(f, (r) => { setStepTemplateAnalysis(r); setData(p => ({ ...p, template: f.name + " — " + (r.summary || "") })); }, () => setAnalyzingTemplate(false));
                        }} />
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, textAlign: "center" }}>Skip this if you don't have a template — agent produces best-effort output</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ background: C.success + "0A", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.85rem", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ color: C.success }}>✓</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, flex: 1 }}>{stepTemplateFile.name}</span>
                      <button onClick={() => { setStepTemplateFile(null); setStepTemplateAnalysis(null); setData(p => ({ ...p, template: "" })); }} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>Remove</button>
                    </div>
                    {analyzingTemplate && <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.gold, padding: "0.3rem 0" }}>○ Reading template...</div>}
                    {stepTemplateAnalysis && <div style={{ background: C.code, border: "1px solid " + C.success + "33", borderRadius: "8px", padding: "0.65rem 0.85rem" }}><div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>TEMPLATE ANALYZED</div><div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#80A890" }}>{stepTemplateAnalysis.summary}</div></div>}
                  </div>
                )}
              </div>
            ) : (
              <>
                <textarea value={val} onChange={e => setData(p => ({ ...p, [cur.key]: e.target.value }))}
                  placeholder={cur.placeholder} rows={4}
                  style={{ width: "100%", background: C.card, border: "1px solid " + (val ? C.accent + "55" : C.border), borderRadius: "10px", padding: "0.8rem", color: C.text, fontFamily: "monospace", fontSize: "0.78rem", lineHeight: 1.7, resize: "none", transition: "border 0.2s" }} />
                {cur.hint && <div style={{ fontFamily: "monospace", fontSize: "0.56rem", color: C.muted, marginTop: "0.4rem", lineHeight: 1.5 }}>{cur.hint}</div>}
              </>
            )}

            {/* Coaching hints */}
            {hintsLoading && <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem" }}><span style={{ color: C.cyan, fontFamily: "monospace", fontSize: "0.6rem" }}>○</span><span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.cyan }}>Reviewing...</span></div>}

            {!hintsLoading && hints.length > 0 && !cur.isTemplate && !cur.isStandingContext && !cur.isHumanGate && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.49rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>WHAT'S MISSING — click to add or mark not relevant</div>
                {hints.map((h, i) => (
                  <HintCard key={i} hint={h} index={i} state={hintStates[i] || null}
                    onInject={handleInject} onDismiss={handleDismiss} onDiscuss={handleDiscuss} />
                ))}
              </div>
            )}

            {/* Chat */}
            {!cur.isStandingContext && !cur.isTemplate && (
              <div style={{ marginTop: "0.8rem" }}>
                <ChatBox open={chatOpen}
                  onToggle={() => { setChatOpen(p => !p); if (!chatOpen && !chatHistory.length) setChatHistory([{ role: "assistant", content: "This step: \"" + cur.headline + "\". What would you like to know?" }]); }}
                  history={chatHistory} onSend={handleChatSend} loading={chatLoading} solution={chatSolution}
                  onInjectSolution={() => { skipNextCoach.current = true; setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " + chatSolution })); setChatSolution(""); }}
                  onDiscardSolution={() => setChatSolution("")} />
              </div>
            )}

            {/* Blueprint panel */}
            {stepIdx > 0 && data.concept && <BlueprintPanel data={data} currentLabel={cur.headline} workflowLabel={workflowLabel} />}
          </div>

          {/* Footer */}
          <div style={{ padding: "0.7rem 1.25rem 0.9rem", borderTop: "1px solid " + C.border, flexShrink: 0, display: "flex", gap: "0.45rem" }}>
            {stepIdx > 0 && <button onClick={goBack} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>Back</button>}
            {cur.optional && <button onClick={goNext} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>Skip</button>}
            <button onClick={goNext} disabled={!canProceed() || hintsLoading}
              style={{ flex: 1, background: canProceed() && !hintsLoading ? "linear-gradient(135deg," + C.accent + "," + C.gold + ")" : C.dim, border: "none", borderRadius: "8px", padding: "0.75rem", color: canProceed() ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 800, cursor: canProceed() ? "pointer" : "not-allowed", transition: "background 0.2s" }}>
              {isLast ? "REVIEW & LAUNCH →" : "NEXT →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
