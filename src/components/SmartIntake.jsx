import { useState, useRef, useEffect } from "react";

// ─── TOKENS ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
  purple: "#A78BFA", error: "#EF4444",
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
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

const parseJSON = (text) => {
  const s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/[\[{][\s\S]*[\]}]/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
};

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = e => resolve(e.target.result);
  r.onerror = reject;
  file.type === "application/pdf" ? r.readAsDataURL(file) : r.readAsText(file);
});

// ─── DOMAIN CONTEXT — 25+ industry/workflow patterns ─────────────────────────
const getDomainContext = (text) => {
  const l = (text || "").toLowerCase();
  if (l.includes("material request") || l.includes("purchase order") || l.includes("mr form") || (l.includes("fills out") && l.includes("form")) || (l.includes("vendor quote") && l.includes("form")))
    return "DOMAIN: This agent reads a VENDOR QUOTE (input) and fills out a company MATERIAL REQUEST or PURCHASE ORDER FORM (output). These are different documents. The form structure is critical — the agent must know exact field names, column order, and required fields. Always ask if the company has an existing MR/PO template to upload. Without the actual form, the agent produces a generic output that won't match the company's format.";
  if (l.includes("submittal log") || l.includes("submittal register"))
    return "DOMAIN: A submittal log is an OUTPUT built by reading construction SPECIFICATION documents. Input = spec PDFs. Output = the formatted log. Approved products lists → structured JSON/CSV lookup tables, not prose PDFs. Past submittal logs → structured few-shot examples.";
  if (l.includes("rfi") || (l.includes("change order") && l.includes("construction")))
    return "DOMAIN: RFI/CO agents read RFI documents + contract terms (inputs), produce impact analysis memos or formal notice letters (outputs). Contract documents are standing context, not runtime inputs.";
  if (l.includes("co notice") || (l.includes("notice") && l.includes("change")))
    return "DOMAIN: CO notice agents read RFI/RFC documents and contract terms (inputs), produce formal written notice letters asserting change order rights. Contract is standing context.";
  if (l.includes("punch list"))
    return "DOMAIN: Punch list agents read inspection notes or photos (inputs) and produce a formatted punch list document (output).";
  if (l.includes("contract review") || l.includes("contract analysis"))
    return "DOMAIN: Contract review agents read contract documents (inputs) and produce risk summaries, redlines, or clause extractions (outputs). They do not modify the original contract. Company contract positions are standing context.";
  if ((l.includes("invoice") || l.includes("bill")) && (l.includes("extract") || l.includes("process") || l.includes("review") || l.includes("approv")))
    return "DOMAIN: Invoice processing agents read invoice PDFs or emails (inputs) and produce structured data records, approval requests, or accounting entries (outputs). Approval policy is standing context.";
  if (l.includes("lease") && (l.includes("abstract") || l.includes("review") || l.includes("extract")))
    return "DOMAIN: Lease abstraction agents read lease documents (inputs) and produce structured summaries of key terms: dates, rent, options, obligations (outputs).";
  if (l.includes("nda") || l.includes("non-disclosure") || (l.includes("agreement") && l.includes("review")))
    return "DOMAIN: Agreement review agents read contract documents (inputs) and produce risk summaries or redlines (outputs). Preferred positions and standards are standing context.";
  if (l.includes("medical record") || l.includes("patient record") || l.includes("clinical note"))
    return "DOMAIN: Medical record agents read clinical documents, notes, or lab results (inputs) and produce structured summaries, coded entries, or alerts (outputs). HIPAA compliance required.";
  if (l.includes("prior auth") || l.includes("prior authorization"))
    return "DOMAIN: Prior auth agents read clinical criteria and patient records (inputs) and produce authorization requests or approval/denial decisions (outputs).";
  if (l.includes("expense") && (l.includes("report") || l.includes("approv") || l.includes("process")))
    return "DOMAIN: Expense agents read receipts, credit card statements, or expense forms (inputs) and produce categorized expense reports or approval requests (outputs). Expense policy is standing context.";
  if (l.includes("reconcil"))
    return "DOMAIN: Reconciliation agents read two or more data sources — bank statements and accounting records (inputs) — and produce a discrepancy report or matched/unmatched transaction list (outputs).";
  if (l.includes("financial report") || l.includes("financial statement"))
    return "DOMAIN: Financial reporting agents read raw transaction data or accounting records (inputs) and produce formatted financial statements or summaries (outputs).";
  if (l.includes("lead") && (l.includes("qualify") || l.includes("score") || l.includes("enrich")))
    return "DOMAIN: Lead qualification agents read prospect data, form submissions, or enrichment data (inputs) and produce scored/enriched lead records or routed assignments (outputs). ICP definition is standing context.";
  if (l.includes("proposal") && (l.includes("generat") || l.includes("creat") || l.includes("draft") || l.includes("build")))
    return "DOMAIN: Proposal generation agents read deal data, client requirements, and product info (inputs) and produce formatted proposal documents (outputs). Pricing tables and product catalog are standing context.";
  if (l.includes("crm") && (l.includes("update") || l.includes("sync") || l.includes("log")))
    return "DOMAIN: CRM update agents read emails, call transcripts, or meeting notes (inputs) and produce structured CRM field updates or activity logs (outputs).";
  if (l.includes("resum") || (l.includes("cv") && (l.includes("screen") || l.includes("review") || l.includes("rank"))))
    return "DOMAIN: Resume screening agents read job descriptions and candidate resumes (inputs) and produce ranked shortlists, fit scores, or pass/fail recommendations (outputs). Job description and scoring rubric are standing context.";
  if (l.includes("onboard"))
    return "DOMAIN: Onboarding agents read new hire data and company policy documents (inputs) and produce checklists, task assignments, or welcome communications (outputs). Policy docs are standing context.";
  if (l.includes("ticket") && (l.includes("triage") || l.includes("route") || l.includes("classif") || l.includes("priorit")))
    return "DOMAIN: Ticket triage agents read incoming support tickets (inputs) and produce classified, prioritized, and routed ticket assignments (outputs). They do not resolve tickets.";
  if (l.includes("support") && (l.includes("draft") || l.includes("reply") || l.includes("response")))
    return "DOMAIN: Support response agents read customer messages and knowledge base articles (inputs) and produce draft replies for human review (outputs). KB articles are standing context.";
  if ((l.includes("email") || l.includes("inbox")) && (l.includes("draft") || l.includes("reply") || l.includes("response") || l.includes("triage")))
    return "DOMAIN: Email agents read incoming emails and context (inputs) and produce draft replies or triage decisions (outputs). They never send without human approval.";
  if (l.includes("research") && (l.includes("report") || l.includes("summary") || l.includes("brief") || l.includes("compil")))
    return "DOMAIN: Research agents read web sources, documents, or databases (inputs) and produce synthesized reports or summaries (outputs). Source library is standing context.";
  if (l.includes("content") && (l.includes("generat") || l.includes("creat") || l.includes("draft") || l.includes("write")))
    return "DOMAIN: Content generation agents read briefs, brand guidelines, and reference material (inputs) and produce written content (outputs). Brand guide and tone docs are standing context.";
  if (l.includes("seo") || l.includes("keyword"))
    return "DOMAIN: SEO agents read existing content or target topics (inputs) and produce keyword analyses, optimized content, or recommendations (outputs).";
  return "";
};

// ─── OUTPUT DETECTION ─────────────────────────────────────────────────────────
const outputIsForm = (text) => {
  const l = (text || "").toLowerCase();
  return l.includes("fill") || l.includes("form") || l.includes("fills out") || l.includes("populate") ||
    l.includes("material request") || l.includes("purchase order") || l.includes("mr ") || l.includes(" po ");
};

const outputIsDocument = (text) => {
  const l = (text || "").toLowerCase();
  return l.includes("form") || l.includes("report") || l.includes("log") || l.includes("document") ||
    l.includes("spreadsheet") || l.includes("template") || l.includes("letter") || l.includes("memo") ||
    l.includes("invoice") || l.includes("proposal") || l.includes("summary") || l.includes("sheet") ||
    l.includes("request") || l.includes("record") || l.includes("tracker") || l.includes("notice") ||
    l.includes("certificate") || l.includes("contract") || l.includes("fill") || l.includes("populate");
};

// ─── BUILD FULL CONTEXT STRING ────────────────────────────────────────────────
const buildContext = (data) => {
  const parts = [];
  if (data.concept) parts.push("CONCEPT: " + data.concept);
  if (data.inputs) parts.push("INPUTS: " + data.inputs);
  if (data.outputs) parts.push("OUTPUTS: " + data.outputs);
  if (data.template) parts.push("OUTPUT TEMPLATE: " + data.template);
  if (data.standingContext) parts.push("STANDING CONTEXT: " + data.standingContext);
  if (data.humanGate) parts.push("HUMAN OVERSIGHT: " + data.humanGate);
  return parts.join("\n");
};

// ─── TEMPLATE ANALYSIS ────────────────────────────────────────────────────────
const analyzeTemplate = async (file, onResult, onDone) => {
  try {
    const content = await readFile(file);
    let messages;
    if (file.type === "application/pdf") {
      messages = [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: content.split(",")[1] } },
        { type: "text", text: "This is a form or template an AI agent will fill out. Analyze it and return JSON only:\n{\"fields\":[\"field1\",\"field2\",...],\"required_inputs\":\"what data the user must provide each run\",\"trigger\":\"when this form is typically used\",\"outputs\":\"what the completed form looks like\",\"humanGate\":\"when a human should review before submitting\",\"summary\":\"one sentence: what this form is for\"}" }
      ]}];
    } else {
      messages = [{ role: "user", content: "This form/template an AI agent will fill out:\n\n" + content.substring(0, 4000) + "\n\nAnalyze it. Return JSON only:\n{\"fields\":[\"field1\",\"field2\",...],\"required_inputs\":\"what data the user must provide each run\",\"trigger\":\"when this form is typically used\",\"outputs\":\"what the completed form looks like\",\"humanGate\":\"when a human should review before submitting\",\"summary\":\"one sentence: what this form is for\"}" }];
    }
    const raw = await callClaude(messages, "", 600);
    const result = parseJSON(raw);
    if (result) onResult(result);
  } catch (e) { console.error("Template analysis failed:", e); }
  onDone();
};

// ─── STATIC FALLBACKS ─────────────────────────────────────────────────────────
const getFallback = (concept, key) => {
  const l = (concept || "").toLowerCase();
  if (l.includes("material request") || l.includes("purchase order") || l.includes("mr form")) {
    const m = { inputs: "The vendor quote document (PDF or Excel) uploaded manually each run.", outputs: "A completed Material Request or Purchase Order form with all fields populated from the vendor quote.", humanGate: "Before the completed form is submitted or shared, and when a required field cannot be found in the vendor quote." };
    return m[key] || "";
  }
  if (l.includes("submittal") || l.includes("construction") || l.includes("rfi")) {
    const m = { inputs: "Specification PDFs (relevant divisions), project name, and any bulletins or addenda.", outputs: "Formatted Excel submittal log with spec section, description, submittal type, required-by date, and status.", humanGate: "Before delivering to external parties, and when a spec section cannot be parsed or two documents conflict." };
    return m[key] || "";
  }
  if (l.includes("email") || l.includes("inbox")) {
    const m = { inputs: "Email subject, sender, full body text, and any attachments.", outputs: "A draft reply staged for review, plus a notification that it is ready.", humanGate: "Before sending any reply externally, and when the topic requires judgment the agent doesn't have context for." };
    return m[key] || "";
  }
  const g = { inputs: "The documents, data, or requests the agent reads each time it runs.", outputs: "A completed document, structured data record, or formatted report.", humanGate: "Before taking any irreversible action, sending anything externally, or when confidence in a result is low." };
  return g[key] || "";
};

const getFallbackHints = (stepKey) => {
  const maps = {
    inputs: [
      { gap: "File type not specified", why: "An agent that expects PDFs but receives Excel files will fail on every run — silently.", options: ["PDF documents uploaded manually each run", "Excel or CSV files from a shared folder", "email attachments of a specific type"] },
      { gap: "Supporting context missing", why: "Without project or job metadata, the agent can't label its output correctly.", options: ["the project name and responsible party", "the vendor or supplier name", "the date and version number"] },
    ],
    outputs: [
      { gap: "Output format not specific enough", why: "Vague format means different output structure every run — you can't build a process on inconsistency.", options: ["a filled-out Excel form matching our company template", "a PDF formatted for external sharing", "a structured JSON record for our system"] },
      { gap: "Output delivery not defined", why: "Without a delivery destination, every output requires manual retrieval.", options: ["saved to a shared folder I specify", "emailed to me as an attachment", "shown on screen for review before saving"] },
    ],
    humanGate: [
      { gap: "No review gate before delivery", why: "Without this gate, errors reach their destination with no safety net — you only discover mistakes after they've caused problems.", options: ["always show me the output before saving or sending", "only pause if a required field couldn't be filled", "run automatically — I'll review outputs myself"] },
      { gap: "No handling for missing fields", why: "A blank field that goes unnoticed is worse than a flagged gap — the form looks complete but isn't.", options: ["stop and ask me for any missing required field", "leave blank and flag it clearly in the output", "make a best guess and mark it for my review"] },
    ],
    concept: [
      { gap: "Output format not described", why: "Without knowing the output format, we can't generate an agent that produces consistent results.", options: ["a filled-out form matching our company template", "a formatted spreadsheet with specific columns", "a draft document ready for my review"] },
      { gap: "Trigger not specified", why: "Without a trigger, we can't deploy this as a running agent.", options: ["when I manually upload a file", "on a scheduled basis", "when a file arrives in a specific folder"] },
    ],
  };
  return maps[stepKey] || maps.concept;
};

// ─── DEFAULT HUMAN GATES ──────────────────────────────────────────────────────
const getDefaultGates = () => [
  { key: "before_output", label: "Before delivering output", desc: "Always show me the completed result before it is saved, sent, or submitted.", enabled: true },
  { key: "missing_field", label: "When a required field is missing", desc: "Stop and ask me if the source document doesn't contain a required field.", enabled: true },
  { key: "low_confidence", label: "When confidence is below 80%", desc: "Flag for my review when the agent is uncertain about a value it extracted or computed.", enabled: true },
  { key: "external_action", label: "Before any external action", desc: "Pause before sending, submitting, or sharing anything outside this session.", enabled: false },
];

// ─── STANDING CONTEXT CATEGORIES ──────────────────────────────────────────────
const STANDING_CATEGORIES = [
  { key: "contracts", label: "Contracts & Scope", desc: "How your agent knows what's included vs. what's a change.", example: "Subcontract, prime contract, scope of work, SOW" },
  { key: "specifications", label: "Specifications", desc: "What materials, methods, or standards are required.", example: "Project specs, division PDFs, addenda, bulletins" },
  { key: "drawings", label: "Drawings & Designs", desc: "What was originally designed — for comparison and conflict detection.", example: "Drawing sets, sheet indexes, ASIs, design documents" },
  { key: "standards", label: "Company Standards", desc: "How your company does things — your process, language, and approach.", example: "SOPs, response templates, internal guidelines, playbooks" },
  { key: "approved", label: "Approved Lists", desc: "Who you work with and what you use — flags anything outside your standards.", example: "Approved vendors, approved products, preferred manufacturers" },
  { key: "codes", label: "Codes & Regulations", desc: "The rules your agent has to work within.", example: "OSHA standards, building codes, local AHJ requirements, regulations" },
  { key: "history", label: "Historical Reference", desc: "How similar situations were handled before — keeps decisions consistent.", example: "Past logs, resolved cases, prior decisions, approved precedents" },
];

// ─── HINT CARD ────────────────────────────────────────────────────────────────
function HintCard({ hint, index, addedOption, onInject, onDiscuss }) {
  const isAdded = !!addedOption;
  return (
    <div style={{ background: isAdded ? C.success + "08" : "#0D1B27", border: "1px solid " + (isAdded ? C.success + "33" : "#1D3246"), borderRadius: "9px", padding: "0.75rem 0.85rem", marginBottom: "0.4rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <span style={{ color: isAdded ? C.success : C.accent, flexShrink: 0, fontSize: "0.65rem", marginTop: "3px" }}>{isAdded ? "✓" : "→"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: isAdded ? C.muted : "#D0E4EE", lineHeight: 1.4, marginBottom: "0.3rem", fontWeight: 600 }}>{hint.gap}</div>
          {hint.why && !isAdded && (
            <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: "#5A8898", lineHeight: 1.55, marginBottom: "0.5rem", background: C.dim, borderRadius: "5px", padding: "0.3rem 0.5rem", borderLeft: "2px solid " + C.muted }}>
              {hint.why}
            </div>
          )}
          {isAdded ? (
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.success }}>Added: "{addedOption}"</div>
          ) : (
            <div>
              {hint.options?.length > 0 && (
                <div style={{ marginBottom: "0.4rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.cyan, marginBottom: "0.3rem", letterSpacing: "0.06em" }}>PICK A SOLUTION TO INJECT:</div>
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
              <button onClick={() => onDiscuss(hint.gap)} style={{ background: "transparent", border: "1px solid #1D3246", borderRadius: "5px", padding: "0.28rem 0.65rem", color: "#7090A8", fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer" }}>
                Discuss instead
              </button>
            </div>
          )}
        </div>
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
    <button onClick={onToggle} style={{ width: "100%", background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.55rem 0.85rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", textAlign: "left" }}>
      <span style={{ color: C.cyan }}>?</span><span>Not sure what this means? Ask me anything.</span>
    </button>
  ) : (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: C.dim, padding: "0.4rem 0.7rem", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>Assistant — knows your full agent context</span>
        <button onClick={onToggle} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "1rem" }}>×</button>
      </div>
      <div style={{ maxHeight: "180px", overflowY: "auto", padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {history.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ background: m.role === "user" ? C.accent : C.dim, color: m.role === "user" ? "#000" : C.text, borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", padding: "0.45rem 0.6rem", fontFamily: "monospace", fontSize: "0.63rem", lineHeight: 1.6, maxWidth: "88%" }}>
              {m.content}
            </div>
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

// ─── TEMPLATE STEP ────────────────────────────────────────────────────────────
function TemplateStepUI({ isForm, templateFile, templateAnalysis, analyzing, onUpload, onRemoveTemplate }) {
  const [path, setPath] = useState(null);
  const fileRef = useRef(null);

  if (!path) return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {[
        { id: "upload", label: isForm ? "Upload our existing form" : "Upload our existing template", desc: isForm ? "Your agent learns your exact fields, column names, and format. Without it, it produces generic output you'll have to reformat every run." : "Your agent follows your exact output structure every run.", rec: true },
        { id: "generate", label: "Help me create one", desc: "We'll suggest a structure based on your agent description and industry standards. You review it before launch.", rec: false },
        { id: "skip", label: "Skip for now", desc: "Agent produces best-effort output. Your dashboard will prompt you to add a template after your first run.", rec: false },
      ].map(opt => (
        <button key={opt.id} onClick={() => { setPath(opt.id); if (opt.id !== "upload") onUpload(null, opt.id); }}
          style={{ background: C.card, border: "1px solid " + (opt.rec ? C.gold + "66" : C.border), borderRadius: "10px", padding: "0.85rem 1rem", cursor: "pointer", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
            <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: opt.rec ? C.gold : C.text, fontWeight: 600 }}>{opt.label}</span>
            {opt.rec && <span style={{ fontFamily: "monospace", fontSize: "0.44rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>RECOMMENDED</span>}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, lineHeight: 1.5 }}>{opt.desc}</div>
        </button>
      ))}
    </div>
  );

  if (path === "upload") return (
    <div>
      <button onClick={() => { setPath(null); onRemoveTemplate(); }} style={{ background: "transparent", border: "none", color: C.muted, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer", marginBottom: "0.65rem", padding: 0 }}>← Choose different path</button>
      {!templateFile ? (
        <div onClick={() => fileRef.current.click()} style={{ border: "2px dashed " + C.gold + "55", borderRadius: "10px", padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer", background: C.dim }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.gold, marginBottom: "0.3rem" }}>Drop your form here or tap to upload</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>Excel, PDF, Word, or CSV</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }} onChange={e => e.target.files[0] && onUpload(e.target.files[0], "upload")} />
        </div>
      ) : (
        <div>
          <div style={{ background: C.success + "0A", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.85rem", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ color: C.success }}>✓</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, flex: 1 }}>{templateFile.name}</span>
            <button onClick={onRemoveTemplate} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>Remove</button>
          </div>
          {analyzing && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0" }}>
              <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem", display: "inline-block" }}>○</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.gold }}>Reading your form — extracting fields and structure...</span>
            </div>
          )}
          {templateAnalysis && !analyzing && (
            <div style={{ background: C.code, border: "1px solid " + C.success + "33", borderRadius: "8px", padding: "0.65rem 0.85rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.35rem" }}>FORM ANALYZED — steps pre-filled from your template</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#80A890", lineHeight: 1.6, marginBottom: "0.4rem" }}>{templateAnalysis.summary}</div>
              {templateAnalysis.fields?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {templateAnalysis.fields.slice(0, 14).map((f, i) => (
                    <span key={i} style={{ background: C.success + "22", border: "1px solid " + C.success + "33", borderRadius: "4px", padding: "0.1rem 0.4rem", fontFamily: "monospace", fontSize: "0.47rem", color: C.success }}>{f}</span>
                  ))}
                  {templateAnalysis.fields.length > 14 && <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted }}>+{templateAnalysis.fields.length - 14} more</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // generate or skip paths
  return (
    <div>
      <button onClick={() => { setPath(null); onRemoveTemplate(); }} style={{ background: "transparent", border: "none", color: C.muted, fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer", marginBottom: "0.65rem", padding: 0 }}>← Choose different path</button>
      <div style={{ background: C.dim, border: "1px solid " + (path === "generate" ? C.gold + "33" : C.border), borderRadius: "8px", padding: "0.85rem 1rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: path === "generate" ? C.gold : C.muted, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>{path === "generate" ? "TEMPLATE WILL BE GENERATED" : "SKIPPING TEMPLATE"}</div>
        <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, lineHeight: 1.6 }}>
          {path === "generate" ? "Based on your agent description and industry standards, we'll create a draft template structure. You'll review and adjust it from your dashboard before your first run." : "Your agent will produce best-effort output. Your dashboard will prompt you to add a template after your first run, showing you exactly what was inconsistent."}
        </div>
      </div>
    </div>
  );
}

// ─── STANDING CONTEXT ACCORDION ───────────────────────────────────────────────
function StandingContextAccordion({ uploads, onUpload, onRemove }) {
  const [open, setOpen] = useState({});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {STANDING_CATEGORIES.map(cat => {
        const catUploads = uploads.filter(u => u.category === cat.key);
        const isOpen = open[cat.key];
        return (
          <div key={cat.key} style={{ background: C.card, border: "1px solid " + (catUploads.length > 0 ? C.success + "44" : C.border), borderRadius: "8px", overflow: "hidden" }}>
            <div onClick={() => setOpen(p => ({ ...p, [cat.key]: !p[cat.key] }))}
              style={{ padding: "0.65rem 0.85rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {catUploads.length > 0 && <span style={{ color: C.success, fontSize: "0.65rem" }}>✓</span>}
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: C.text, fontWeight: 600 }}>{cat.label}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.05rem" }}>{cat.desc}</div>
                </div>
              </div>
              <span style={{ color: C.muted, fontFamily: "monospace", fontSize: "0.7rem", flexShrink: 0, marginLeft: "0.5rem" }}>{isOpen ? "▴" : "▾"}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "0.55rem 0.85rem 0.75rem", borderTop: "1px solid " + C.border }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: "#4A6878", marginBottom: "0.5rem", lineHeight: 1.5 }}>e.g. {cat.example}</div>
                {catUploads.map((u, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: C.success + "0A", border: "1px solid " + C.success + "33", borderRadius: "5px", padding: "0.35rem 0.6rem", marginBottom: "0.25rem" }}>
                    <span style={{ color: C.success, fontSize: "0.6rem" }}>+</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.text, flex: 1 }}>{u.name}</span>
                    <button onClick={() => onRemove(u)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>×</button>
                  </div>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: C.dim, border: "1px dashed " + C.cyan + "44", borderRadius: "6px", padding: "0.45rem 0.65rem", cursor: "pointer" }}>
                  <span style={{ color: C.cyan }}>+</span>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.muted }}>Upload for {cat.label}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.49rem", color: "#3A5060", marginTop: "0.05rem" }}>PDF, Word, Excel, CSV — uploaded once, available every run</div>
                  </div>
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
function HumanGateToggles({ gates, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {gates.map(gate => (
        <div key={gate.key} style={{ background: C.card, border: "1px solid " + (gate.enabled ? C.accent + "44" : C.border), borderRadius: "9px", padding: "0.7rem 0.9rem", display: "flex", alignItems: "flex-start", gap: "0.85rem" }}>
          <button onClick={() => onToggle(gate.key)}
            style={{ width: "36px", height: "20px", borderRadius: "10px", background: gate.enabled ? C.accent : C.dim, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", transition: "background 0.2s", marginTop: "2px" }}>
            <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#fff", position: "absolute", top: "3px", left: gate.enabled ? "19px" : "3px", transition: "left 0.2s" }} />
          </button>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, fontWeight: 600, marginBottom: "0.15rem" }}>{gate.label}</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, lineHeight: 1.5 }}>{gate.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SUGGESTION CARD ──────────────────────────────────────────────────────────
function SuggestionCard({ suggestion, onUse, onAdjust, onSkip }) {
  const [adjusting, setAdjusting] = useState(false);
  const [adjustInput, setAdjustInput] = useState("");

  return (
    <div style={{ background: "#0E1A26", border: "1px solid " + C.gold + "55", borderRadius: "10px", overflow: "hidden", marginBottom: "0.7rem" }}>
      <div style={{ background: C.gold + "18", padding: "0.4rem 0.85rem", borderBottom: "1px solid " + C.gold + "22", display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>SUGGESTED FOR YOUR AGENT</span>
      </div>
      <div style={{ padding: "0.75rem 0.85rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: C.text, lineHeight: 1.7, marginBottom: "0.7rem" }}>{suggestion}</div>
        {adjusting ? (
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginBottom: "0.3rem" }}>What's wrong with this? I'll regenerate it.</div>
            <input value={adjustInput} onChange={e => setAdjustInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && adjustInput.trim()) { onAdjust(adjustInput.trim()); setAdjusting(false); setAdjustInput(""); } }} placeholder="e.g. We use XML files, not CSV..." autoFocus style={{ width: "100%", background: C.code, border: "1px solid " + C.gold + "44", borderRadius: "6px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", outline: "none", marginBottom: "0.4rem" }} />
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button onClick={() => { if (adjustInput.trim()) { onAdjust(adjustInput.trim()); setAdjusting(false); setAdjustInput(""); } }} disabled={!adjustInput.trim()} style={{ flex: 1, background: adjustInput.trim() ? C.gold : C.dim, border: "none", borderRadius: "6px", padding: "0.38rem", color: adjustInput.trim() ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: adjustInput.trim() ? "pointer" : "not-allowed" }}>Regenerate</button>
              <button onClick={() => { setAdjusting(false); setAdjustInput(""); }} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.38rem 0.65rem", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.35rem" }}>
            <button onClick={onUse} style={{ background: "linear-gradient(135deg," + C.gold + ",#D97706)", border: "none", borderRadius: "7px", padding: "0.5rem", color: "#000", fontFamily: "monospace", fontSize: "0.58rem", fontWeight: 700, cursor: "pointer", gridColumn: "1 / -1" }}>Use This</button>
            <button onClick={() => setAdjusting(true)} style={{ background: "transparent", border: "1px solid " + C.gold + "55", borderRadius: "7px", padding: "0.42rem", color: C.gold, fontFamily: "monospace", fontSize: "0.56rem", cursor: "pointer" }}>Adjust</button>
            <button onClick={onSkip} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "7px", padding: "0.42rem", color: C.muted, fontFamily: "monospace", fontSize: "0.56rem", cursor: "pointer", gridColumn: "2 / -1" }}>Skip suggestion</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BLUEPRINT PANEL ──────────────────────────────────────────────────────────
function BlueprintPanel({ data, currentStepKey, workflowLabel }) {
  const rows = [
    { label: "DOES", value: data.concept, key: "concept" },
    { label: "READS", value: data.inputs, key: "inputs" },
    { label: "PRODUCES", value: data.outputs, key: "outputs" },
    { label: "TEMPLATE", value: data.template, key: "template" },
    { label: "OVERSIGHT", value: data.humanGate, key: "humanGate" },
  ].filter(r => r.value);

  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: "0.85rem", background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ padding: "0.38rem 0.65rem", background: C.dim, borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.muted, letterSpacing: "0.08em" }}>AGENT BLUEPRINT SO FAR</span>
        <span style={{ fontFamily: "monospace", fontSize: "0.46rem", color: C.accent }}>{workflowLabel || "building..."}</span>
      </div>
      <div style={{ padding: "0.5rem 0.65rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <span style={{ fontFamily: "monospace", fontSize: "0.43rem", color: C.accent, flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "52px" }}>{r.label}</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.54rem", color: "#5A8898", lineHeight: 1.5 }}>{r.value.length > 80 ? r.value.substring(0, 80) + "..." : r.value}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", borderTop: "1px solid " + C.dim, paddingTop: "0.25rem", marginTop: "0.05rem" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.43rem", color: C.gold, flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "52px" }}>NOW</span>
          <span style={{ fontFamily: "monospace", fontSize: "0.54rem", color: C.gold + "88", lineHeight: 1.5, fontStyle: "italic" }}>Answering: {currentStepKey}</span>
        </div>
      </div>
    </div>
  );
}

// ─── LAUNCH SUMMARY ───────────────────────────────────────────────────────────
function LaunchSummary({ data, classification, standingUploads, humanGates, onLaunch, onBack }) {
  const agentName = data.name || "My Agent";
  const enabledGates = humanGates.filter(g => g.enabled).map(g => g.label.toLowerCase());
  const standingCount = standingUploads.length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
      <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "640px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.1em", marginBottom: "0.2rem" }}>REVIEW YOUR AGENT</div>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: C.text }}>{agentName}</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.5rem" }}>
          <div style={{ background: C.dim, border: "1px solid " + C.border, borderRadius: "10px", padding: "1rem 1.1rem", marginBottom: "1rem" }}>
            {[
              { label: "WHAT IT DOES", value: data.concept },
              { label: "WHAT STARTS IT", value: "You upload " + (data.inputs || "your document") + " directly" },
              { label: "WHAT IT READS", value: data.inputs },
              { label: "WHAT IT PRODUCES", value: data.outputs },
              { label: "TEMPLATE", value: data.template || (standingCount > 0 ? "Agent will use best-effort format — add from dashboard" : "None specified — add from dashboard") },
              { label: "STANDING CONTEXT", value: standingCount > 0 ? standingCount + " document" + (standingCount > 1 ? "s" : "") + " uploaded" : "None — you can add from dashboard after launch" },
              { label: "WHEN IT STOPS", value: enabledGates.length > 0 ? enabledGates.join(", ") : "Runs automatically — you review output" },
            ].filter(r => r.value).map((r, i) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: "0.55rem", paddingBottom: "0.55rem", borderBottom: i < 6 ? "1px solid " + C.border : "none" }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, flexShrink: 0, minWidth: "110px", marginTop: "2px", letterSpacing: "0.06em" }}>{r.label}</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text, lineHeight: 1.6 }}>{r.value}</span>
              </div>
            ))}
          </div>

          <div style={{ background: C.accent + "0D", border: "1px solid " + C.accent + "33", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.07em", marginBottom: "0.2rem" }}>YOUR FIRST RUN IS FREE</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, lineHeight: 1.6 }}>After that, $199/month keeps it running, monitored, and improving. No card required to start.</div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={onBack} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 1rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer" }}>← Back</button>
            <button onClick={onLaunch} style={{ flex: 1, background: "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "8px", padding: "0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}>
              LAUNCH {agentName.toUpperCase()} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BLUEPRINT COMPLETE SCREEN ────────────────────────────────────────────────
function BlueprintCompleteScreen({ data, classification, standingUploads, humanGates, templateAnalysis, onRestart, onComplete }) {
  const [copied, setCopied] = useState(false);

  const buildJSON = () => ({
    agent_id: "agent_" + Date.now(),
    agent_name: data.name || "My Agent",
    industry: classification?.industry || "general",
    workflow_type: classification?.workflow_type || "document_processor",
    complexity: classification?.complexity || "medium",
    concept: data.concept,
    trigger: { type: "manual_upload" },
    runtime_inputs: data.inputs,
    output: {
      description: data.outputs,
      template: data.template || null,
      template_fields: templateAnalysis?.fields || [],
    },
    standing_context: standingUploads.map(u => ({ name: u.name, category: u.category })),
    human_gates: humanGates.filter(g => g.enabled).map(g => ({ trigger: g.key, label: g.label, action: "pause_and_notify" })),
    system_prompt: {
      role: "You are " + (data.name || "a specialized AI agent") + ". " + (data.concept || ""),
      constraints: [
        "Use actual values from inputs — never placeholders",
        ...(data.humanGate ? [data.humanGate] : []),
        "Log confidence score with every output",
        "Classify every failure — TRANSIENT, HARD, AMBIGUOUS, or LOGIC",
      ],
    },
    failure_handling: { unreadable_document: "pause_and_notify", missing_required_field: "flag_and_continue", low_confidence: "include_score_and_flag" },
    observability: { log_every_run: true, log_fields: ["input_hash", "confidence", "duration_ms", "token_cost", "human_gate_triggered"] },
    pricing: { free_runs: 1 },
    deployment: { infrastructure: "railway", runtime: "python_3.11", framework: "anthropic_sdk" },
  });

  const blueprint = JSON.stringify(buildJSON(), null, 2);
  const deployPrompt = `Build a production AI agent from this blueprint. Python 3.11 + Anthropic SDK.\n\nBUILD ORDER:\n1. Supabase state schema for agent runs\n2. Document ingestion: chunk + embed all standing_context with pgvector\n3. Core agent loop: perceive → retrieve → decide → act → observe\n4. Tool contracts: one function per external action, idempotent\n5. System prompt from blueprint.system_prompt\n6. Human gate handlers from blueprint.human_gates\n7. Failure handlers from blueprint.failure_handling\n8. Output formatter matching blueprint.output.template_fields\n9. Observability: log all fields in blueprint.observability.log_fields\n10. Entry point: agent.py accepting file upload and running the full loop\n\nCONSTRAINTS:\n- All state persisted to Supabase before returning\n- All runs logged to agent_runs table\n- Human gates = async pauses with webhook callback\n- No hardcoded secrets — all from environment variables\n- Retry transient failures 3 times before notifying\n- Every function has error handling — no silent failures\n\nBLUEPRINT:\n${blueprint}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
      <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "700px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.1em", marginBottom: "0.15rem" }}>✓ BLUEPRINT COMPLETE</div>
            <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.text }}>{data.name || "Your Agent"} is ready to build.</div>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(deployPrompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }}
            style={{ background: copied ? C.success : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "7px", padding: "0.5rem 0.9rem", color: copied ? "#fff" : "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>
            {copied ? "✓ COPIED" : "COPY FOR CLAUDE CODE"}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted, marginBottom: "0.4rem", letterSpacing: "0.07em" }}>DEPLOYABLE AGENT JSON — paste this into Claude Code to build</div>
          <pre style={{ background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", padding: "1rem", fontFamily: "monospace", fontSize: "0.58rem", color: "#B0D4E0", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: "0 0 1rem", overflowX: "auto" }}>
            {blueprint}
          </pre>
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

// ─── PRE-STEP ─────────────────────────────────────────────────────────────────
function PreStep({ onClassified }) {
  const [val, setVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const classify = async (concept) => {
    const domainCtx = getDomainContext(concept);
    const isForm = outputIsForm(concept);
    const isDoc = outputIsDocument(concept);
    try {
      const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}User wants to automate: "${concept}"\n\nClassify and return ONLY JSON:\n{"industry":"construction|legal|finance|hr|sales|support|healthcare|general","workflow_type":"form_filling|document_processor|classifier|drafter|researcher|data_updater","complexity":"simple|medium|complex","output_is_form":true|false,"required_steps":["concept","inputs","outputs","name"],"understanding":"I'm treating this as [specific business process at their company]..."}\n\nrequired_steps rules: always include concept,inputs,outputs,name. Add template if output_is_form=true or agent fills a form. Add standing_context if complexity=medium or complex. Add humanGate if complexity=complex or agent takes external actions. Only include what changes what the agent does.` }], "", 500);
      const parsed = parseJSON(raw);
      if (parsed?.required_steps) return parsed;
    } catch (e) {}
    return {
      industry: "general",
      workflow_type: isForm ? "form_filling" : isDoc ? "document_processor" : "document_processor",
      complexity: isForm ? "medium" : "simple",
      output_is_form: isForm,
      required_steps: ["concept", "inputs", "outputs", ...(isDoc ? ["template"] : []), ...(isForm ? ["standing_context"] : []), "name"],
      understanding: "I'm treating this as a document processing agent that reads inputs and produces structured output.",
    };
  };

  const handleSubmit = async () => {
    if (val.trim().length < 10) return;
    setLoading(true); setError("");
    try {
      const cls = await classify(val.trim());
      onClassified(val.trim(), cls);
    } catch (e) {
      setError("Connection issue — using defaults.");
      onClassified(val.trim(), { industry: "general", workflow_type: "document_processor", complexity: "medium", output_is_form: outputIsForm(val), required_steps: ["concept", "inputs", "outputs", "template", "standing_context", "humanGate", "name"], understanding: "I'm treating this as a document processing agent." });
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
        <textarea value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if ((e.key === "Enter" && e.metaKey) || (e.key === "Enter" && e.ctrlKey)) handleSubmit(); }}
          placeholder="e.g. an agent that fills out company material request forms by populating items from vendor quotes..." rows={4}
          style={{ width: "100%", background: C.card, border: "1px solid " + (val ? C.accent + "55" : C.border), borderRadius: "12px", padding: "1rem", color: C.text, fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.7, resize: "none", marginBottom: "0.75rem" }} />
        {error && <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.error, marginBottom: "0.5rem" }}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading || val.trim().length < 10}
          style={{ width: "100%", background: loading || val.trim().length < 10 ? C.dim : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "10px", padding: "0.9rem", color: loading || val.trim().length < 10 ? C.muted : "#000", fontFamily: "monospace", fontSize: "0.72rem", fontWeight: 800, cursor: loading || val.trim().length < 10 ? "not-allowed" : "pointer", marginBottom: "0.6rem" }}>
          {loading ? "Analyzing your workflow..." : "Build My Agent →"}
        </button>
        <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, textAlign: "center" }}>Your first run is free. No card required to start.</div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SmartIntake({ onComplete }) {
  const [screen, setScreen] = useState("pre");
  const [classification, setClassification] = useState(null);
  const [steps, setSteps] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [suggestState, setSuggestState] = useState("idle");

  // Coaching
  const [hints, setHints] = useState([]);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [addedOptions, setAddedOptions] = useState({});
  const [aiUnderstanding, setAiUnderstanding] = useState("");
  const [correctingUnderstanding, setCorrectingUnderstanding] = useState(false);
  const [correctionInput, setCorrectionInput] = useState("");

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSolution, setChatSolution] = useState("");

  // Template
  const [templateFile, setTemplateFile] = useState(null);
  const [templateAnalysis, setTemplateAnalysis] = useState(null);
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  const [templatePath, setTemplatePath] = useState(null); // "upload"|"generate"|"skip"

  // Standing context
  const [standingUploads, setStandingUploads] = useState([]);

  // Human gates
  const [humanGates, setHumanGates] = useState(getDefaultGates());
  const [gatesGenerated, setGatesGenerated] = useState(false);

  // Refs
  const coachTimer = useRef(null);
  const skipNextCoach = useRef(false);
  const correctionRef = useRef("");

  const cur = steps[stepIdx];
  const val = cur ? (data[cur.key] || "") : "";
  const isLast = stepIdx === steps.length - 1;
  const pct = steps.length > 0 ? Math.round((stepIdx / (steps.length - 1)) * 100) : 0;

  // Build steps from classification
  const buildSteps = (cls) => {
    const rs = cls?.required_steps || ["concept", "inputs", "outputs", "name"];
    const defs = {
      concept: {
        key: "concept", headline: "What should your agent do?",
        sub: "Describe it like you're explaining it to a new employee. What comes in, what comes out.",
        placeholder: "e.g. Read vendor quote PDFs and fill out our company's standard Material Request form with all the line items, quantities, and prices from the quote...",
        hint: "Include: what it reads, what it produces, and any accuracy requirements.",
      },
      inputs: {
        key: "inputs", headline: "What does it read each time you run it?",
        sub: "Every time you give your agent work, what does it need to look at?",
        placeholder: "e.g. The vendor quote PDF — uploaded manually each time I run it...",
        hint: "This is the new work you hand it each run. Documents it always has access to are set up separately.",
      },
      outputs: {
        key: "outputs", headline: "What do you want when it's done?",
        sub: "When the agent finishes, what should exist that didn't before? Be specific.",
        placeholder: "e.g. A completed Material Request form with all vendor quote line items in the correct columns, quantities, unit prices, and totals filled in...",
        hint: "The more specific you are, the more consistent it gets. 'A summary' means something different every run. 'A one-page memo with specific fields' means the same thing every time.",
      },
      template: {
        key: "template", isTemplate: true, noCoach: true,
        headline: cls?.output_is_form ? "Does your company have a standard form for this?" : "Does it follow a specific output format?",
        sub: cls?.output_is_form
          ? "Your agent fills out a form. Upload your actual form and it will learn your exact fields, column names, and structure. Without it, it produces generic output you'll have to reformat every run."
          : "If your company has a standard template or format for this output, upload it. Your agent will follow your exact structure every time.",
        optional: !cls?.output_is_form,
      },
      standing_context: {
        key: "standing_context", isStandingContext: true, noCoach: true, optional: true,
        headline: "What does it always need access to?",
        sub: "Upload once. Lives in your agent permanently. Available on every run automatically — you never think about it again.",
      },
      humanGate: {
        key: "humanGate", isHumanGate: true, optional: true,
        headline: "When should it stop and check with you?",
        sub: "Your agent handles routine work automatically. Configure the moments where it stops and gets you before proceeding.",
        starterHints: [
          { gap: "No review gate before delivering output", why: "Without this gate, errors reach their destination with no safety net. You only discover mistakes after they've caused problems.", options: ["always show me the output before saving or sending", "only pause if a required field couldn't be filled", "run automatically — I'll review the output myself afterwards"] },
          { gap: "No handling when source data is unclear or missing", why: "A blank field that goes unnoticed is worse than a flagged gap — the form looks complete but isn't.", options: ["stop and ask me for any missing required field", "leave the field blank and flag it clearly", "make a best guess and mark it for my review"] },
          { gap: "No check when agent confidence is low", why: "Some inputs are ambiguous. An agent that guesses silently produces unpredictable output.", options: ["flag for review when confidence is below 80%", "always note when it had to make a judgment call", "run automatically and highlight any low-confidence values"] },
        ],
        coachQ: (val, ctx) => `Agent context:\n${ctx}\n\nOversight described: "${val}"\n\nWhat oversight gates are missing? Think about: external actions, silent failures, irreversible steps. Return ONLY JSON array:\n[{"gap":"short label","why":"what goes wrong without this gate","options":["A","B","C"]}]`,
      },
      name: {
        key: "name", headline: "Give it a name.", sub: "What do you want to call this agent?",
        placeholder: "e.g. MR Scout, Quote Parser, Spec Builder...",
        hint: "Names make agents feel real.", noSuggest: true, noCoach: true,
      },
    };
    return rs.filter(k => defs[k]).map(k => defs[k]);
  };

  // Pre-step classification done
  const handleClassified = async (concept, cls) => {
    const builtSteps = buildSteps(cls);
    setClassification(cls);
    setSteps(builtSteps);
    setData({ concept });
    setAiUnderstanding(cls.understanding || "");
    setScreen("steps");
    setStepIdx(0);

    // Generate suggestions for all steps from concept
    setSuggestState("loading");
    try {
      const domainCtx = getDomainContext(concept);
      const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}Agent: "${concept}"\nIndustry: ${cls.industry}\nWorkflow: ${cls.workflow_type}\n\nGenerate specific, concrete suggestions. Simplest approach first. Return ONLY JSON:\n{"inputs":"...","outputs":"...","humanGate":"..."}` }], "", 500);
      const parsed = parseJSON(raw) || {};
      const fb = {};
      ["inputs", "outputs", "humanGate"].forEach(k => { fb[k] = parsed[k] || getFallback(concept, k); });
      setSuggestions(fb);
    } catch {
      const fb = {};
      ["inputs", "outputs", "humanGate"].forEach(k => { fb[k] = getFallback(concept, k); });
      setSuggestions(fb);
    }
    setSuggestState("done");
  };

  // Generate context-aware hints for standing_context step
  const generateContextHints = async (stepKey) => {
    if (stepKey !== "standing_context" || !data.concept) return;
    const ctx = buildContext(data);
    try {
      const raw = await callClaude([{ role: "user", content: `Agent context:\n${ctx}\n\nWhat types of standing documents would most improve this agent's accuracy? Think about what it would need to reference every run. Return ONLY JSON array (max 3):\n[{"gap":"short label","why":"why this document helps","options":["specific doc A","specific doc B","specific doc C"]}]` }], "", 400);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed) && parsed.length > 0) setHints(parsed);
    } catch {}
  };

  // Generate human gate suggestions for complex agents
  const generateGates = async () => {
    if (gatesGenerated) return;
    const ctx = buildContext(data);
    try {
      const raw = await callClaude([{ role: "user", content: `Agent context:\n${ctx}\n\nGenerate 4 specific human oversight gate suggestions. Think about: external actions, silent failure modes, irreversible steps, judgment calls better made by humans.\n\nReturn ONLY JSON array:\n[{"key":"snake_key","label":"short label for what triggers this gate","desc":"one sentence: what the agent pauses to ask about","enabled":true}]` }], "", 400);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setHumanGates(parsed);
        setGatesGenerated(true);
      }
    } catch {}
  };

  // Coaching effect — runs when text changes
  useEffect(() => {
    if (!cur || cur.noCoach || val.trim().length < 20) { setHints([]); return; }
    if (skipNextCoach.current) { skipNextCoach.current = false; return; }
    clearTimeout(coachTimer.current);
    coachTimer.current = setTimeout(async () => {
      setHintsLoading(true);
      try {
        const ctx = buildContext(data);
        const correction = correctionRef.current ? `IMPORTANT: User clarified: "${correctionRef.current}". Use this context everywhere.\n\n` : "";
        const domainCtx = cur.key === "concept" ? getDomainContext(val) : getDomainContext(data.concept || "");

        let q;
        if (cur.key === "concept") {
          q = `${domainCtx ? domainCtx + "\n\n" : ""}${correction}Agent description: "${val}"\n\nReturn JSON with exactly these keys:\n{"understanding":"I'm treating this as [specific business process assumption at their company]...","hints":[{"gap":"short label","why":"one sentence: what goes wrong without this","options":["option A","option B","option C"]}]}\n\n2-3 hints max. Make options specific to THIS agent. Return ONLY JSON.`;
        } else if (cur.coachQ) {
          q = cur.coachQ(val, buildContext(data));
        } else {
          const stepLabel = { inputs: "inputs", outputs: "outputs", humanGate: "human oversight" }[cur.key] || cur.key;
          q = `${domainCtx ? domainCtx + "\n\n" : ""}${correction}Agent context:\n${ctx}\n\n${stepLabel} described: "${val}"\n\nWhat is missing or incomplete? Options must be specific to THIS agent. Return ONLY JSON array:\n[{"gap":"short label","why":"what goes wrong without this","options":["A","B","C"]}]`;
        }

        const raw = await callClaude([{ role: "user", content: q }], "", 500);
        const parsed = parseJSON(raw);

        if (parsed && !Array.isArray(parsed) && parsed.hints) {
          if (parsed.understanding && cur.key === "concept") setAiUnderstanding(parsed.understanding);
          const arr = parsed.hints || [];
          if (arr.length > 0) setHints(arr.slice(0, 3).filter(h => h.gap));
          else setHints(getFallbackHints(cur.key));
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          setHints(parsed.slice(0, 3).filter(h => h.gap));
        } else {
          setHints(getFallbackHints(cur.key));
        }
      } catch {
        setHints(getFallbackHints(cur.key));
      }
      setHintsLoading(false);
    }, 1200);
    return () => clearTimeout(coachTimer.current);
  }, [val, cur?.key]);

  // Step change effect
  useEffect(() => {
    if (!cur) return;
    setHints([]); setHintsLoading(false); setAddedOptions({});
    setChatOpen(false); setChatHistory([]); setChatSolution("");
    setCorrectingUnderstanding(false); setCorrectionInput("");
    if (cur.key !== "concept") setAiUnderstanding("");

    // Context hints for standing_context
    if (cur.key === "standing_context") generateContextHints("standing_context");
    // Generate gates for humanGate step
    if (cur.key === "humanGate" && !gatesGenerated) generateGates();
  }, [stepIdx]);

  const handleInject = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + (p[cur.key] ? ", " : "") + option }));
    setAddedOptions(p => ({ ...p, [index]: option }));
  };

  const handleDiscussHint = (gap) => {
    setChatOpen(true);
    setChatHistory([{ role: "assistant", content: `Let's figure out: "${gap.substring(0, 80)}". How does this apply to your agent specifically?` }]);
  };

  const handleChatSend = async (msg) => {
    setChatLoading(true);
    const hist = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(hist);
    try {
      const ctx = buildContext(data);
      const domainCtx = getDomainContext(data.concept || "");
      const sys = `${domainCtx ? domainCtx + "\n\n" : ""}You help people design AI agents. Agent context:\n${ctx}\n\nCurrent step: "${cur.headline}" — ${cur.sub}\n\nRULES:\n1. Stay on current step only\n2. When you reach a clear conclusion, end with: SOLUTION: [one sentence]\n3. Under 80 words\n4. Concrete examples from their specific agent only`;
      const r = await callClaude(hist, sys, 250);
      const solutionMatch = r.match(/SOLUTION:\s*(.+?)(?:\n|$)/i);
      if (solutionMatch) {
        setChatSolution(solutionMatch[1].trim());
        setChatHistory([...hist, { role: "assistant", content: r.replace(/SOLUTION:\s*.+?(?:\n|$)/i, "").trim() }]);
      } else {
        setChatSolution("");
        setChatHistory([...hist, { role: "assistant", content: r }]);
      }
    } catch {
      setChatHistory([...hist, { role: "assistant", content: "Connection issue, try again." }]);
    }
    setChatLoading(false);
  };

  const goNext = () => {
    if (!cur) return;
    // Validation: required steps need content (except isTemplate/isStandingContext/isHumanGate which have their own UX)
    const hasContent = cur.isTemplate || cur.isStandingContext || cur.isHumanGate || val.trim().length > 0;
    const canProceed = cur.optional || hasContent;
    if (!canProceed) return;

    if (isLast) {
      setScreen("launch");
    } else {
      setStepIdx(s => s + 1);
    }
  };

  const goBack = () => {
    if (stepIdx > 0) setStepIdx(s => s - 1);
    else setScreen("pre");
  };

  const canProceedCurrent = () => {
    if (!cur) return false;
    if (cur.optional || cur.isTemplate || cur.isStandingContext || cur.isHumanGate) return true;
    return val.trim().length > 0;
  };

  if (screen === "pre") return <PreStep onClassified={handleClassified} />;

  if (screen === "launch") return (
    <LaunchSummary
      data={data}
      classification={classification}
      standingUploads={standingUploads}
      humanGates={humanGates}
      onLaunch={() => {
        if (typeof onComplete === "function") {
          onComplete({
            agentName: data.name || "My Agent",
            concept: data.concept,
            inputs: data.inputs,
            outputs: data.outputs,
            template: data.template,
            templateAnalysis,
            templatePath,
            standingContext: standingUploads.map(u => u.name).join(", "),
            humanGate: humanGates.filter(g => g.enabled).map(g => g.label).join("; "),
            classification,
          });
        }
        setScreen("blueprint");
      }}
      onBack={() => setScreen("steps")}
    />
  );

  if (screen === "blueprint") return (
    <BlueprintCompleteScreen
      data={data}
      classification={classification}
      standingUploads={standingUploads}
      humanGates={humanGates}
      templateAnalysis={templateAnalysis}
      onRestart={() => { setScreen("pre"); setData({}); setStepIdx(0); setClassification(null); setSteps([]); setStandingUploads([]); setHumanGates(getDefaultGates()); setTemplateFile(null); setTemplateAnalysis(null); setTemplatePath(null); setSuggestions({}); setSuggestState("idle"); correctionRef.current = ""; }}
      onComplete={onComplete}
    />
  );

  if (!cur) return null;

  const workflowLabel = classification?.workflow_type?.replace(/_/g, " ").toUpperCase() || "BUILDING";
  const hasSuggestion = !cur.noSuggest && suggestions[cur.key] && stepIdx > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; } input, textarea { outline: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeup { from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none} }
        .fadein { animation: fadeup 0.2s ease; }
        .intake-modal { background:#0B0F16; border:1px solid #182430; width:100%; max-width:540px; border-radius:16px 16px 0 0; border-bottom:none; max-height:94vh; display:flex; flex-direction:column; overflow:hidden; }
        @media(min-width:700px) { .intake-outer{align-items:center;padding:2rem} .intake-modal{border-radius:14px;border-bottom:1px solid #182430;max-width:680px;max-height:90vh} }
        @media(min-width:1100px) { .intake-modal{max-width:780px} }
      `}</style>

      <div className="intake-outer" style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", width: "100%" }}>
        <div className="intake-modal">

          {/* Header */}
          <div style={{ padding: "0.85rem 1.25rem 0.6rem", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, letterSpacing: "0.1em" }}>{workflowLabel}</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted }}>{pct}%</span>
            </div>
            <div style={{ height: "3px", background: C.dim, borderRadius: "2px", overflow: "hidden", marginBottom: "0.3rem" }}>
              <div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg," + C.accent + "," + C.gold + ")", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              {steps.map((_, i) => (
                <div key={i} style={{ flex: 1, height: "2px", borderRadius: "1px", background: i < stepIdx ? C.accent : i === stepIdx ? C.gold : C.dim, transition: "background 0.3s" }} />
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="fadein" style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.25rem 0.5rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.45rem", margin: "0 0 0.2rem", color: C.text, lineHeight: 1.15 }}>{cur.headline}</h2>
            <p style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.muted, margin: "0 0 0.85rem", lineHeight: 1.6 }}>
              {cur.sub}{cur.optional && <span style={{ color: C.accent }}> — optional</span>}
            </p>

            {/* AI Understanding Card */}
            {aiUnderstanding && cur.key === "concept" && (
              <div className="fadein" style={{ background: "#0A1520", border: "1px solid " + C.cyan + "33", borderRadius: "8px", overflow: "hidden", marginBottom: "0.75rem" }}>
                <div style={{ padding: "0.4rem 0.75rem", background: C.cyan + "0D", borderBottom: "1px solid " + C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ color: C.cyan, fontSize: "0.6rem" }}>◈</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.cyan, letterSpacing: "0.07em" }}>MY UNDERSTANDING OF YOUR PROCESS</span>
                  </div>
                  {!correctingUnderstanding && (
                    <button onClick={() => setCorrectingUnderstanding(true)} style={{ background: "transparent", border: "1px solid " + C.cyan + "44", borderRadius: "4px", padding: "0.15rem 0.5rem", color: C.cyan, fontFamily: "monospace", fontSize: "0.48rem", cursor: "pointer" }}>Correct this</button>
                  )}
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.63rem", color: "#90B0C8", lineHeight: 1.6 }}>{aiUnderstanding}</div>
                  {correctingUnderstanding && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginBottom: "0.3rem" }}>Tell me what this actually means at your company:</div>
                      <input value={correctionInput} onChange={e => setCorrectionInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && correctionInput.trim()) { correctionRef.current = correctionInput; setAiUnderstanding(""); setCorrectingUnderstanding(false); setCorrectionInput(""); setHints([]); skipNextCoach.current = false; setData(p => ({ ...p, concept: (p.concept || "").trimEnd() + " " })); } }}
                        placeholder="e.g. At our company, a material request means taking a vendor quote and filling out our own PO form..."
                        style={{ width: "100%", background: C.code, border: "1px solid " + C.cyan + "44", borderRadius: "5px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", marginBottom: "0.35rem" }} />
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button onClick={() => { if (!correctionInput.trim()) return; correctionRef.current = correctionInput; setAiUnderstanding(""); setCorrectingUnderstanding(false); setCorrectionInput(""); setHints([]); skipNextCoach.current = false; setData(p => ({ ...p, concept: (p.concept || "").trimEnd() + " " })); }}
                          style={{ background: C.cyan, border: "none", borderRadius: "5px", padding: "0.35rem 0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>Update recommendations</button>
                        <button onClick={() => { setCorrectingUnderstanding(false); setCorrectionInput(""); }} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.35rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Suggestion card */}
            {hasSuggestion && !val && (
              <SuggestionCard
                suggestion={suggestions[cur.key]}
                onUse={() => setData(p => ({ ...p, [cur.key]: suggestions[cur.key] }))}
                onAdjust={async (feedback) => {
                  const domainCtx = getDomainContext(data.concept || "");
                  const raw = await callClaude([{ role: "user", content: `${domainCtx ? domainCtx + "\n\n" : ""}Agent: "${data.concept}"\nOriginal suggestion for "${cur.key}": "${suggestions[cur.key]}"\nFeedback: "${feedback}"\n\nRegenerate ONLY the suggestion for "${cur.key}". Return plain text, no JSON, no labels.` }], "", 200);
                  setSuggestions(p => ({ ...p, [cur.key]: raw.trim() }));
                }}
                onSkip={() => setSuggestions(p => ({ ...p, [cur.key]: "_skipped" }))}
              />
            )}

            {/* Template step */}
            {cur.isTemplate ? (
              <TemplateStepUI
                isForm={classification?.output_is_form}
                templateFile={templateFile}
                templateAnalysis={templateAnalysis}
                analyzing={analyzingTemplate}
                onUpload={(file, path) => {
                  setTemplatePath(path);
                  setTemplateFile(file);
                  if (file && path === "upload") {
                    setAnalyzingTemplate(true);
                    analyzeTemplate(file, (result) => {
                      setTemplateAnalysis(result);
                      setSuggestions(prev => ({
                        ...prev,
                        inputs: result.required_inputs || prev.inputs,
                        outputs: result.outputs || prev.outputs,
                        humanGate: result.humanGate || prev.humanGate,
                      }));
                      setData(p => ({ ...p, template: file.name + " — " + (result.summary || "") }));
                    }, () => setAnalyzingTemplate(false));
                  } else if (path === "generate") {
                    setData(p => ({ ...p, template: "Generated template — review in dashboard" }));
                  } else if (path === "skip") {
                    setData(p => ({ ...p, template: "None — agent uses best-effort output format" }));
                  }
                }}
                onRemoveTemplate={() => { setTemplateFile(null); setTemplateAnalysis(null); setTemplatePath(null); setData(p => ({ ...p, template: "" })); }}
              />
            ) : cur.isStandingContext ? (
              <StandingContextAccordion
                uploads={standingUploads}
                onUpload={(file, category) => setStandingUploads(p => [...p, { name: file.name, file, category }])}
                onRemove={(item) => setStandingUploads(p => p.filter(u => u !== item))}
              />
            ) : cur.isHumanGate ? (
              <div>
                <HumanGateToggles gates={humanGates} onToggle={(key) => setHumanGates(p => p.map(g => g.key === key ? { ...g, enabled: !g.enabled } : g))} />
                {cur.starterHints && !hintsLoading && hints.length === 0 && !val && (
                  <div style={{ marginTop: "0.65rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>ADDITIONAL OPTIONS — click to add more context</div>
                    {cur.starterHints.map((h, i) => (
                      <HintCard key={i} hint={h} index={1000 + i} addedOption={addedOptions[1000 + i] || null} onInject={(idx, opt) => { handleInject(idx, opt); setData(p => ({ ...p, humanGate: (p.humanGate || "").trimEnd() + (p.humanGate ? "; " : "") + opt })); skipNextCoach.current = true; }} onDiscuss={handleDiscussHint} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <textarea value={val} onChange={e => setData(p => ({ ...p, [cur.key]: e.target.value }))}
                  placeholder={cur.placeholder}
                  rows={4}
                  style={{ width: "100%", background: C.card, border: "1px solid " + (val ? C.accent + "55" : C.border), borderRadius: "10px", padding: "0.8rem", color: C.text, fontFamily: "monospace", fontSize: "0.78rem", lineHeight: 1.7, resize: "none", transition: "border 0.2s", display: "block" }} />
                {cur.hint && <div style={{ fontFamily: "monospace", fontSize: "0.56rem", color: C.muted, marginTop: "0.4rem", lineHeight: 1.5 }}>{cur.hint}</div>}
              </>
            )}

            {/* Hints loading */}
            {hintsLoading && !cur.isTemplate && !cur.isStandingContext && !cur.isHumanGate && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem" }}>
                <span style={{ color: C.cyan, fontFamily: "monospace", fontSize: "0.6rem", display: "inline-block" }}>○</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.cyan }}>Reviewing your description...</span>
              </div>
            )}

            {/* Hint cards */}
            {!hintsLoading && hints.length > 0 && !cur.isTemplate && !cur.isStandingContext && (
              <div className="fadein" style={{ marginTop: "0.5rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.49rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>WHAT'S MISSING — click to fill in automatically</div>
                {hints.map((h, i) => (
                  <HintCard key={i} hint={h} index={i} addedOption={addedOptions[i] || null} onInject={handleInject} onDiscuss={handleDiscussHint} />
                ))}
              </div>
            )}

            {/* Standing context hints */}
            {cur.isStandingContext && hints.length > 0 && (
              <div style={{ marginTop: "0.65rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.49rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.4rem" }}>SUGGESTED FOR YOUR AGENT — based on what you've described</div>
                {hints.map((h, i) => (
                  <HintCard key={i} hint={h} index={i} addedOption={addedOptions[i] || null}
                    onInject={(idx, opt) => { setAddedOptions(p => ({ ...p, [idx]: opt })); }}
                    onDiscuss={handleDiscussHint} />
                ))}
              </div>
            )}

            {/* Chat */}
            {!cur.isStandingContext && !cur.isTemplate && (
              <div style={{ marginTop: "0.8rem" }}>
                <ChatBox
                  open={chatOpen}
                  onToggle={() => { setChatOpen(p => !p); if (!chatOpen && chatHistory.length === 0) setChatHistory([{ role: "assistant", content: "This step asks: \"" + cur.headline + "\". What would you like to know?" }]); }}
                  history={chatHistory}
                  onSend={handleChatSend}
                  loading={chatLoading}
                  solution={chatSolution}
                  onInjectSolution={() => { skipNextCoach.current = true; setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " + chatSolution })); setChatSolution(""); }}
                  onDiscardSolution={() => setChatSolution("")}
                />
              </div>
            )}

            {/* Blueprint panel */}
            {stepIdx > 0 && data.concept && (
              <BlueprintPanel data={data} currentStepKey={cur.headline} workflowLabel={workflowLabel} />
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: "0.7rem 1.25rem 0.9rem", borderTop: "1px solid " + C.border, flexShrink: 0, display: "flex", gap: "0.45rem" }}>
            {stepIdx > 0 && (
              <button onClick={goBack} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>Back</button>
            )}
            {cur.optional && (
              <button onClick={goNext} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>Skip</button>
            )}
            <button onClick={goNext} disabled={!canProceedCurrent() || hintsLoading}
              style={{ flex: 1, background: canProceedCurrent() && !hintsLoading ? "linear-gradient(135deg," + C.accent + "," + C.gold + ")" : C.dim, border: "none", borderRadius: "8px", padding: "0.75rem", color: canProceedCurrent() ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 800, cursor: canProceedCurrent() ? "pointer" : "not-allowed", transition: "background 0.2s" }}>
              {isLast ? "REVIEW & LAUNCH →" : "NEXT →"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
