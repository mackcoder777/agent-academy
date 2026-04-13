// SmartIntake.jsx PART 1 OF 2 — Agent Academy | April 2026 (LATEST — TRIGGER FIX)
// KEY FIX: All trigger/systems suggestions now manual-only. No email API, no platform integrations, no OAuth.
// Combine: cat SmartIntake_part1.txt SmartIntake_part2.txt > SmartIntake.jsx

import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

const C = {
  bg: "#F8F9FB", surface: "#FFFFFF", card: "#FFFFFF", border: "#E5E7EB",
  accent: "#7C3AED", gold: "#7C3AED", text: "#1F2937", muted: "#6B7280",
  dim: "#F3F4F6", code: "#F9FAFB", success: "#059669", cyan: "#7C3AED",
};

const callClaude = async (messages, system, max_tokens) => {
  const res = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: max_tokens || 600, messages, ...(system ? { system } : {}) }),
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

const getFallback = (concept, key) => {
  const l = (concept || "").toLowerCase();
  const isConstruction = l.includes("submittal") || l.includes("construction") || l.includes("rfi");
  if (isConstruction) {
    const m = {
      trigger: "When I manually upload specification PDF files directly into the agent interface.",
      inputs: "Specification PDFs (all relevant divisions), project name, and any bulletins or addenda.",
      outputs: "Formatted Excel submittal log with item number, spec section, description, submittal type, required-by date, and status columns.",
      knowledge: "Past submittal logs from similar projects and spec section naming conventions.",
      systems: "A shared Box or Google Drive folder for spec storage and output delivery.",
      humanGate: "Before delivering the log to any external party, and whenever it finds a spec section it cannot parse.",
    };
    return m[key] || "";
  }
  const generic = {
    trigger: "When I manually upload a file or document directly into the agent interface.",
    inputs: "The data, documents, or requests the agent needs to read before it can begin.",
    outputs: "A completed document, updated record, or structured file ready for download.",
    knowledge: "Structured lookup tables it queries and formatted past examples it follows — not prose documents.",
    systems: "A shared Box or Google Drive folder for input files and output delivery.",
    humanGate: "Before saving or sharing any output, or when confidence in the result is low.",
  };
  return generic[key] || "";
};

const buildContext = (data, analysis) => {
  const parts = [];
  if (data.concept) parts.push("CONCEPT: " + data.concept);
  if (data.trigger) parts.push("TRIGGER: " + data.trigger);
  if (data.inputs) parts.push("INPUTS: " + data.inputs);
  if (data.outputs) parts.push("OUTPUTS: " + data.outputs);
  if (data.template) parts.push("OUTPUT TEMPLATE: " + data.template);
  if (analysis && analysis.fields && analysis.fields.length > 0) {
    if (analysis.summary) parts.push("TEMPLATE SUMMARY: " + analysis.summary);
    if (analysis.required_inputs) parts.push("SOURCE DOCUMENT NEEDED: " + analysis.required_inputs);
    if (analysis.source_document_fields && analysis.source_document_fields.length > 0)
      parts.push("FIELDS EXTRACTED FROM SOURCE DOCUMENT: " + analysis.source_document_fields.join(", "));
    if (analysis.user_provided_fields && analysis.user_provided_fields.length > 0)
      parts.push("FIELDS USER PROVIDES MANUALLY: " + analysis.user_provided_fields.join(", "));
    if (analysis.computed_fields && analysis.computed_fields.length > 0)
      parts.push("FIELDS AGENT COMPUTES: " + analysis.computed_fields.join(", "));
  }
  if (data.crossReference) parts.push("CROSS-REFERENCE DOCS: " + data.crossReference);
  if (data.knowledge) parts.push("HISTORICAL KNOWLEDGE: " + data.knowledge);
  if (data.systems) parts.push("SYSTEMS: " + data.systems);
  if (data.humanGate) parts.push("HUMAN OVERSIGHT: " + data.humanGate);
  return parts.join("\n");
};

const getFallbackHints = (stepKey, concept) => {
  const maps = {
    concept: [
      { gap: "What starts the agent running?", options: ["when I manually upload a file or document", "when I drag and drop a file into the agent", "when I paste content directly into the agent"] },
      { gap: "What does it produce when finished?", options: ["a formatted spreadsheet or report I can download", "a draft document ready for my review", "an updated record saved to a shared folder"] },
      { gap: "What should happen when the source data changes?", options: ["I upload the updated file and it re-runs", "I paste the new content and it produces a fresh output", "I provide a new file and it shows what changed"] },
    ],
    trigger: [
      { gap: "How does the user provide input to the agent?", options: ["I upload a file directly into the agent interface", "I drag and drop a file into the agent", "I paste content or text directly into the agent"] },
      { gap: "Are there other ways to provide input?", options: ["I provide a Box shared folder link containing the files", "I upload a batch of files at once", "I manually start it after preparing the files"] },
    ],
    inputs: [
      { gap: "What files or documents does it read?", options: ["PDF documents uploaded manually", "files dropped into the agent interface", "text or data pasted directly into the agent"] },
      { gap: "What metadata or context does it need?", options: ["the project name and responsible party", "the date range or version number", "who initiated the request"] },
    ],
    outputs: [
      { gap: "What format is the output?", options: ["an Excel spreadsheet with structured columns", "a PDF report formatted for sharing", "a formatted document ready to download"] },
      { gap: "Where does the output go?", options: ["downloaded directly from the agent as a file", "saved to a shared Box folder", "saved to a Google Drive folder I specify"] },
    ],
    systems: [
      { gap: "Where does it read input from?", options: ["files I upload directly into the agent interface", "a shared Box folder I drop files into", "a Google Drive folder I provide a link to"] },
      { gap: "Where does it deliver output?", options: ["downloaded directly from the agent as a file", "saved to a shared Box folder", "saved to a Google Drive folder I specify"] },
    ],
    humanGate: [
      { gap: "Before output is saved or delivered", options: ["always show me the output for review before saving", "only flag for review if a required field couldn't be filled", "produce the output automatically — I'll review the downloaded file myself"] },
      { gap: "When it encounters something unclear", options: ["when a required field is missing or unreadable", "when two documents contradict each other", "when it is less than 80% confident in a result"] },
    ],
  };
  return maps[stepKey] || maps.concept;
};

const outputIsDocument = (concept) => {
  const l = (concept || "").toLowerCase();
  return l.includes("form") || l.includes("report") || l.includes("log") ||
    l.includes("document") || l.includes("spreadsheet") || l.includes("template") ||
    l.includes("letter") || l.includes("memo") || l.includes("invoice") ||
    l.includes("proposal") || l.includes("summary") || l.includes("sheet") ||
    l.includes("request") || l.includes("record") || l.includes("tracker");
};


const readXlsxAsText = async (file) => {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const lines = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    if (csv.trim()) { lines.push("=== Sheet: " + name + " ==="); lines.push(csv); }
  }
  return lines.join("\n");
};

const analyzeTemplate = async (file, setSuggestions, setAnalysis, setAnalyzing) => {
  setAnalyzing(true);
  try {
    const reader = new FileReader();
    const fileContent = await new Promise((resolve, reject) => {
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      if (file.type === "application/pdf") { reader.readAsDataURL(file); } else if (!file.name.match(/\.xlsx?$/i)) { reader.readAsText(file); } else { resolve(null); return; }
    });
    let messages;
    const prompt = 'Analyze this form that an AI agent will fill out from a source document uploaded by the user. Return JSON only:\n{"fields":["all field names"],"source_document_fields":["fields extracted from uploaded source doc — line items, quantities, prices, dates"],"user_provided_fields":["fields user types manually — codes, names, numbers, approvers"],"computed_fields":["fields agent calculates — totals, page numbers"],"required_inputs":"one sentence: what source document does user upload each time?","trigger":"when is this form typically filled out?","outputs":"completed form description","humanGate":"when should human review before submitting?","summary":"one sentence: what is this form for?"}';
    if (file.type === "application/pdf") {
      const b64 = fileContent.split(",")[1];
      messages = [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: prompt }] }];
    } else {
      messages = [{ role: "user", content: "Form content:\n\n" + fileContent.substring(0, 3000) + "\n\n" + prompt }];
    }
    const raw = await callClaude(messages, "", 600);
    const analysis = parseJSON(raw);
    if (analysis) {
      setAnalysis(analysis);
      setSuggestions(prev => ({ ...prev,
        inputs: analysis.required_inputs || prev.inputs,
        trigger: "When I manually upload a file or document directly into the agent interface.",
        outputs: analysis.outputs || prev.outputs,
        humanGate: analysis.humanGate || prev.humanGate,
      }));
    }
  } catch (e) { console.error("Template analysis failed:", e); }
  setAnalyzing(false);
};

const getDomainContext = (text) => {
  const l = text.toLowerCase();
  if (l.includes("submittal log") || l.includes("submittal register"))
    return "DOMAIN FACT: A submittal log is an OUTPUT built by reading construction SPECIFICATION documents (spec PDFs). Input = spec docs uploaded by user. Output = the log. Do not suggest submittals as inputs.";
  if (l.includes("rfi") || (l.includes("change order") && l.includes("construction")))
    return "DOMAIN FACT: RFI agents read RFI documents (uploaded by user as files) and produce impact analysis memos or notice letters (outputs).";
  if (l.includes("invoice") && (l.includes("extract") || l.includes("process") || l.includes("review")))
    return "DOMAIN FACT: Invoice processing agents read invoice PDFs (uploaded by user) and produce structured data records or approval requests (outputs).";
  if (l.includes("contract review") || l.includes("contract analysis"))
    return "DOMAIN FACT: Contract review agents read contract documents (uploaded by user) and produce risk summaries or clause extractions (outputs).";
  if (l.includes("material request") || l.includes("purchase order") || l.includes("po ") || l.includes(" po"))
    return "DOMAIN FACT: A material request agent reads a vendor quote (uploaded by user as a file) and produces a filled-out company MR/PO form (output). The quote is the input. The completed form is the output.";
  if (l.includes("resum") || (l.includes("cv") && (l.includes("screen") || l.includes("review") || l.includes("rank"))))
    return "DOMAIN FACT: Resume screening agents read job descriptions and candidate resumes (uploaded by user) and produce ranked shortlists or fit scores (outputs).";
  if (l.includes("expense") && (l.includes("report") || l.includes("approv") || l.includes("process")))
    return "DOMAIN FACT: Expense agents read receipts or expense forms (uploaded by user) and produce categorized expense reports (outputs).";
  if (l.includes("lease") && (l.includes("abstract") || l.includes("review") || l.includes("extract")))
    return "DOMAIN FACT: Lease abstraction agents read lease documents (uploaded by user) and produce structured summaries of key terms (outputs).";
  if ((l.includes("email") || l.includes("inbox")) && (l.includes("draft") || l.includes("reply") || l.includes("response") || l.includes("triage")))
    return "DOMAIN FACT: Email agents read email files (uploaded by user as .eml or pasted text — NOT connected to live email) and produce draft reply documents (outputs). No email API required.";
  if (l.includes("research") && (l.includes("report") || l.includes("summary") || l.includes("brief") || l.includes("compil")))
    return "DOMAIN FACT: Research agents read source documents (uploaded by user) and produce synthesized reports or summaries (outputs).";
  return "";
};

const STEPS = [
  {
    key: "concept",
    headline: "What should your agent do?",
    sub: "Describe it like you'd explain it to a colleague. Plain English is perfect.",
    placeholder: "e.g. An agent that reads incoming invoices and extracts line items into a structured spreadsheet, flagging anything over budget...",
    hint: "Include: what triggers it, what it produces, and any ongoing update scenarios.",
    coachQ: (val, concept, ctx, correction) => {
      const domainCtx = getDomainContext(val + " " + (concept||""));
      const correctionCtx = correction ? "IMPORTANT: The user has clarified that at their company, this process means: \"" + correction + "\". Use this understanding.\n\n" : "";
      return (domainCtx ? domainCtx + "\n\n" : "") + correctionCtx +
        "Agent description: \"" + val + "\"\n\n" +
        "IMPORTANT CONSTRAINT: This agent has NO email API, NO platform integrations, NO OAuth. The user manually uploads files or pastes content into the agent interface. All suggestions must reflect this — no live connections to external systems.\n\n" +
        "Return ONLY this JSON:\n{\"understanding\":\"I'm treating [term] as [assumption]...\",\"hints\":[{\"gap\":\"...\",\"options\":[\"...\",\"...\",\"...\"]}]}";
    },
  },
  {
    key: "trigger",
    headline: "What kicks it off?",
    sub: "How does the user provide input to start the agent?",
    placeholder: "e.g. When I manually upload a file or document directly into the agent interface...",
    hint: "The simplest trigger: user uploads a file, drags and drops, pastes content, or provides a Box/Google Drive link. No email or platform connections needed.",
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nCurrent trigger: \"" + val + "\"\n\nCRITICAL: This agent has NO email API, NO platform integrations, NO OAuth. The ONLY valid triggers are:\n- User uploads a file directly into the agent interface\n- User drags and drops a file\n- User pastes content into the agent\n- User provides a Box or Google Drive shared folder link\nDo NOT suggest email, webhooks, project management systems, or any API.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "inputs",
    headline: "What does it read or receive?",
    sub: "What information does it need to do its job?",
    placeholder: "e.g. The documents, data, or files the agent reads to do its job...",
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nInputs described: \"" + val + "\"\n\nWhat inputs are missing? For each gap provide 3 short injectable options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "outputs",
    headline: "What does it produce?",
    sub: "When it finishes, what exists that did not exist before?",
    placeholder: "e.g. A formatted spreadsheet, filled-out form, or structured document ready for download...",
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nOutputs described: \"" + val + "\"\n\nWhat output details are missing? For each gap provide 3 short options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "template",
    headline: "Confirm your output template.",
    sub: "Verify the template the agent will use to format its output.",
    placeholder: "e.g. Our standard company template with the exact columns and format the agent should produce...",
    hint: "Upload the actual file — not a description of it. The agent will learn your exact column structure, field names, and format.",
    optional: true,
    isTemplate: true,
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nOutput template: \"" + val + "\"\n\nWhat template details are missing? For each gap provide 3 short options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "crossReference",
    headline: "What other documents does it need to cross-reference?",
    sub: "Are there secondary documents it should compare against to catch conflicts or inconsistencies?",
    placeholder: "e.g. A reference list or secondary document the agent should compare against to catch conflicts...",
    hint: "Upload once — lives in the agent's permanent document library, available on every run automatically.",
    optional: true,
    starterHints: [
      { gap: "Does it need to verify anything before producing its output?", options: ["no — just process the input and produce the output, no cross-checks needed for v1", "compare against a reference list I upload once to flag anything not approved", "compare against a previous version of the output to catch changes or conflicts"] },
      { gap: "Are there secondary documents it should check against?", options: ["no secondary documents needed for v1 — keep it simple", "a lookup table or reference list I upload once and it checks automatically every run", "a prior output file to detect duplicates or conflicts"] },
    ],
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nCross-reference docs: \"" + val + "\"\n\nIMPORTANT: Suggest simplest options first. All docs are uploaded once by user — no live API connections. For each gap provide 3 options simplest first.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"simplest option\",\"option B\",\"option C\"]}]",
  },
  {
    key: "knowledge",
    headline: "What does it need to look up or reference?",
    sub: "Structured data it queries, past examples it follows, or rules it applies consistently.",
    placeholder: "e.g. A structured lookup table it queries, or formatted past examples it uses as reference...",
    hint: "Upload once — lives in the agent's permanent document library. CSV preferred for lookup tables.",
    optional: true,
    starterHints: [
      { gap: "Structured lookup data it queries", options: ["an approved products/manufacturers list as a structured table (CSV)", "a pricing or cost reference table it queries by item", "a lookup table of standard item descriptions"] },
      { gap: "Formatted examples it follows", options: ["2-3 past completed outputs formatted as structured examples", "sample entries showing correct format and field values", "a reference set of correctly classified items with explanations"] },
    ],
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nReference data: \"" + val + "\"\n\nDistinguish between (1) structured lookup data and (2) formatted few-shot examples. Do NOT suggest prose documents, lessons learned, or behavioral rules. All reference data uploaded once by user. For each gap provide 3 short specific options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "systems",
    headline: "Where does input come from and where does output go?",
    sub: "Box folder, Google Drive, or directly in the agent interface — no APIs needed.",
    placeholder: "e.g. Input files uploaded directly into the agent, output saved to a shared Box folder...",
    hint: "Box and Google Drive shared folders work without any API setup or OAuth. Keep it simple.",
    optional: true,
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nSystems: \"" + val + "\"\n\nCRITICAL: NO OAuth, NO platform APIs. ONLY suggest: (1) files uploaded directly into agent interface, (2) Box shared folder, (3) Google Drive shared folder, (4) downloaded output file. Do NOT suggest email, CRM, project management platforms, or any connection requiring an API key.\n\nFor each gap provide 3 options, all achievable without API setup.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "humanGate",
    headline: "When should it stop and check with you?",
    sub: "What decisions are too important to make on its own?",
    placeholder: "e.g. Before saving any output, when it finds something it cannot resolve confidently...",
    hint: "Good agents know their limits.",
    starterHints: [
      { gap: "Before the output is saved or delivered", options: ["always show me the completed output for review before saving", "only flag for review if a required field couldn't be filled", "produce the output automatically — I'll review the downloaded file myself"] },
      { gap: "When something is missing or unclear in the input", options: ["stop and ask me what value to use for any missing required field", "leave the field blank and flag it with a note", "make a best guess and mark it clearly for my review"] },
      { gap: "For any values I always need to confirm", options: ["ask me to confirm key reference values (like codes, numbers, or IDs) before starting", "use whatever values I provide at the start with no confirmation needed", "pre-fill from the last run and let me change anything before it proceeds"] },
    ],
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nHuman oversight: \"" + val + "\"\n\nWhat oversight gates are missing? When should this specific agent stop and check? For each gap provide 3 short injectable options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "name",
    headline: "Give it a name.",
    sub: "What do you want to call this agent?",
    placeholder: "e.g. Invoice Reader, Contract Analyzer, Report Builder...",
    hint: "Names make agents feel real.",
    noSuggest: true,
    noCoach: true,
  },
];
// SmartIntake.jsx PART 2 OF 2 — Agent Academy | April 2026
// CONTAINS: SmartIntake component with all state, logic, and render
// Combine: cat SmartIntake_part1.txt SmartIntake_part2.txt > SmartIntake.jsx
// ============================================================

export default function SmartIntake({ onComplete }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [suggestState, setSuggestState] = useState("idle");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSolution, setChatSolution] = useState("");
  const [blueprint, setBlueprint] = useState(null);
  const [bpCopied, setBpCopied] = useState(false);
  const [hints, setHints] = useState([]);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [addedOptions, setAddedOptions] = useState({});
  const [aiUnderstanding, setAiUnderstanding] = useState("");
  const [correctingUnderstanding, setCorrectingUnderstanding] = useState(false);
  const [correctionInput, setCorrectionInput] = useState("");
  const [templateFile, setTemplateFile] = useState(null);
  const [templateCategory, setTemplateCategory] = useState("template");
  const [earlyTemplateFile, setEarlyTemplateFile] = useState(null);
  const [templateAnalysis, setTemplateAnalysis] = useState(null);
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  const [ragDocuments, setRagDocuments] = useState([]);
  const templateFileRef = useRef(null);
  const earlyTemplateRef = useRef(null);
  const [contextHints, setContextHints] = useState({});
  const [contextHintsLoading, setContextHintsLoading] = useState(false);
  const coachTimer = useRef(null);
  const skipNextCoach = useRef(false);
  const correctionRef = useRef("");

  const cur = STEPS[step];
  const val = data[cur.key] || "";
  const isLast = step === STEPS.length - 1;
  const canProceed = cur.optional ? true : val.trim().length > 0;
  const hasSuggestion = !cur.noSuggest && suggestions[cur.key] && !suggestions[cur.key].startsWith("_");

  useEffect(() => {
    if (cur.noCoach || val.trim().length < 20) { setHints([]); return; }
    if (skipNextCoach.current) { skipNextCoach.current = false; return; }
    clearTimeout(coachTimer.current);
    coachTimer.current = setTimeout(async () => {
      setHintsLoading(true);
      try {
        const ctx = buildContext(data, templateAnalysis);
        const correction = correctionRef.current || "";
        const q = cur.coachQ(val, data.concept || "", ctx, correction);
        const raw = await callClaude([{ role: "user", content: q }], "", 500);
        const parsed = parseJSON(raw);
        if (parsed && !Array.isArray(parsed) && parsed.hints) {
          if (parsed.understanding) setAiUnderstanding(parsed.understanding);
          const arr = parsed.hints;
          if (Array.isArray(arr) && arr.length > 0) {
            setHints(arr.slice(0, 3).map(item => typeof item === "string" ? { gap: item, options: [] } : { gap: item.gap || "", options: Array.isArray(item.options) ? item.options : [] }).filter(h => h.gap));
          }
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          setHints(parsed.slice(0, 3).map(item => typeof item === "string" ? { gap: item, options: [] } : { gap: item.gap || "", options: Array.isArray(item.options) ? item.options : [] }).filter(h => h.gap));
        } else {
          setHints(getFallbackHints(cur.key, data.concept));
        }
      } catch (e) { setHints(getFallbackHints(cur.key, data.concept)); }
      setHintsLoading(false);
    }, 1300);
    return () => clearTimeout(coachTimer.current);
  }, [val, cur.key]);

  useEffect(() => {
    setHints([]); setHintsLoading(false); setAddedOptions({}); setChatOpen(false); setChatHistory([]); setChatSolution(""); setAiUnderstanding(""); setCorrectingUnderstanding(false); setCorrectionInput("");
    if (!cur.isTemplate) setTemplateFile(null);
    const stepsNeedingContext = ["template", "crossReference", "knowledge", "humanGate", "systems"];
    if (stepsNeedingContext.includes(cur.key) && !contextHints[cur.key] && data.concept) generateContextHints(cur.key);
  }, [step]);

  const generateContextHints = async (stepKey) => {
    setContextHintsLoading(true);
    const contextSoFar = [data.concept && "Concept: " + data.concept, data.trigger && "Trigger: " + data.trigger, data.inputs && "Inputs: " + data.inputs, data.outputs && "Outputs: " + data.outputs, data.template && "Template: " + data.template].filter(Boolean).join("\n");
    const questionMap = {
      template: "What output template or format should this agent follow?",
      crossReference: "What secondary documents should this agent compare against to catch conflicts?",
      knowledge: "What historical records, past examples, or institutional knowledge should this agent reference?",
      systems: "What specific apps or tools does this agent need — for reading input, storing output, or notifying people? Prefer Box, Google Drive, email before platform APIs.",
      humanGate: "When should this agent stop and wait for human approval? Think about irreversible actions, external communications, and situations where it might be wrong.",
    };
    const domainCtx = getDomainContext(data.concept || "");
    try {
      const raw = await callClaude([{ role: "user", content: "Agent being designed:\n\n" + contextSoFar + (templateAnalysis && templateAnalysis.fields ? "\n\nOUTPUT FORM FIELDS: " + templateAnalysis.fields.join(", ") : "") + "\n\n" + (domainCtx ? domainCtx + "\n\n" : "") + "Based on this specific agent, provide 3 concrete options for:\n" + questionMap[stepKey] + "\n\nReturn ONLY JSON array:\n[{\"gap\":\"option category\",\"options\":[\"specific A\",\"specific B\",\"specific C\"]},{\"gap\":\"another category\",\"options\":[\"A\",\"B\",\"C\"]}]" }], "", 400);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed) && parsed.length > 0) setContextHints(p => ({ ...p, [stepKey]: parsed }));
    } catch (e) {}
    setContextHintsLoading(false);
  };

  const generateSuggestions = async (concept) => {
    setSuggestState("loading");
    try {
      const raw = await callClaude([{ role: "user", content: (() => {
        const domainCtx = getDomainContext(concept);
        const tmplCtx = templateAnalysis && templateAnalysis.summary
          ? "\n\nOUTPUT FORM ANALYZED:\nPurpose: " + (templateAnalysis.summary || "") + "\n" +
            (templateAnalysis.required_inputs ? "Source document: " + templateAnalysis.required_inputs + "\n" : "") +
            (templateAnalysis.source_document_fields && templateAnalysis.source_document_fields.length ? "Fields from source doc: " + templateAnalysis.source_document_fields.join(", ") + "\n" : "") +
            (templateAnalysis.user_provided_fields && templateAnalysis.user_provided_fields.length ? "Fields user provides: " + templateAnalysis.user_provided_fields.join(", ") + "\n" : "") +
            "Use this to generate accurate suggestions. INPUT = source document. OUTPUT = completed form."
          : "";
        return "Agent concept: \"" + concept + "\"" + (domainCtx ? "\n\n" + domainCtx : "") + tmplCtx +
          "\n\nGenerate specific suggestions for each field. Always suggest the simplest viable approach first. Return ONLY raw JSON:\n{\"trigger\":\"...\",\"inputs\":\"...\",\"outputs\":\"...\",\"knowledge\":\"...\",\"systems\":\"...\",\"humanGate\":\"when to stop and check with a human before taking action\"}";
      })() }], "", 500);
      const parsed = parseJSON(raw);
      if (parsed && parsed.trigger) { setSuggestions(parsed); }
      else { const fb = {}; ["trigger","inputs","outputs","template","crossReference","knowledge","systems"].forEach(k => { fb[k] = getFallback(concept, k); }); setSuggestions(fb); }
    } catch (e) {
      const fb = {}; ["trigger","inputs","outputs","knowledge","systems"].forEach(k => { fb[k] = getFallback(data.concept || "", k); }); setSuggestions(fb);
    }
    setSuggestState("done");
  };

  const buildBlueprint = (d) => {
    return [
      "# AGENT BLUEPRINT: " + (d.name || "My Agent"),
      "# Agent Academy | Generated " + new Date().toLocaleDateString(),
      "", "## CONCEPT", d.concept || "",
      "", "## TRIGGER CONDITIONS", d.trigger || "(not defined)",
      "", "## INPUTS", d.inputs || "(not defined)",
      "", "## OUTPUTS", d.outputs || "(not defined)",
      "", "## OUTPUT TEMPLATE", d.template || "(none specified)",
      "", "## CROSS-REFERENCE DOCUMENTS", d.crossReference || "(none specified)",
      "", "## RAG DOCUMENT LIBRARY",
      d.ragDocuments && d.ragDocuments.length > 0 ? d.ragDocuments.map(doc => "- " + doc.name + " [" + doc.category + "]").join("\n") : "(none uploaded)",
      templateAnalysis && templateAnalysis.fields ? "\nTEMPLATE FIELDS: " + templateAnalysis.fields.join(", ") : "",
      "", "## HISTORICAL KNOWLEDGE", d.knowledge || "(none specified)",
      "", "## EXTERNAL SYSTEMS", d.systems || "(none specified)",
      "", "## HUMAN OVERSIGHT GATES", d.humanGate || "(not defined)",
      "", "---",
      "DEPLOY WITH CLAUDE CODE:",
      "Build a production-ready agent based on this blueprint.",
      "Use Python with the Anthropic SDK. State in Supabase.",
      "Start with the core loop and failure handling, then add tools.",
      "Follow all architectural decisions exactly as specified.",
    ].join("\n");
  };

  const goNext = () => {
    if (!canProceed) return;
    const newData = { ...data, [cur.key]: val };
    setData(newData);
    if (cur.key === "concept" && val.trim()) generateSuggestions(val.trim());
    if (isLast) {
      const agentOut = { agentName: newData.name || "My Agent", concept: newData.concept, triggers: newData.trigger, inputs: newData.inputs, outputs: newData.outputs, template: newData.template, templateCategory, templateFile: earlyTemplateFile, templateAnalysis, crossReference: newData.crossReference, ragDocuments, rag: newData.knowledge, systems: newData.systems, constraints: newData.humanGate };
      setBlueprint(buildBlueprint(newData));
      if (typeof onComplete === "function") {
        window._agentAcademyComplete = () => onComplete(agentOut);
      }
    } else {
      setStep(s => s + 1);
    }
  };

  const goBack = () => setStep(s => s - 1);
  const skipStep = () => setStep(s => s + 1);

  const handleInject = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + ", " + option }));
    setAddedOptions(p => ({ ...p, [index]: [...(p[index] || []), option] }));
  };

  const handleUndo = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").replace(", " + option, "").replace(option + ", ", "").replace(option, "") }));
    setAddedOptions(p => ({ ...p, [index]: (p[index] || []).filter(o => o !== option) }));
  };

  const handleDiscussHint = (hint) => {
    setChatOpen(true);
    setChatHistory([{ role: "assistant", content: "Let's talk about this gap: \"" + hint.substring(0, 90) + "\". How does this apply to your agent?" }]);
  };

  const handleChatSend = async (msg) => {
    setChatLoading(true);
    const hist = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(hist);
    try {
      const ctx = buildContext(data, templateAnalysis);
      const sys = "You help people design AI agents in plain English.\n\nEverything defined so far:\n" + ctx + "\n\nCurrent step: \"" + cur.headline + "\" — " + cur.sub + "\n\nCRITICAL RULES:\n1. Stay ONLY on the current step. Do NOT ask about or mention future steps.\n2. When you reach a conclusion or solution together, end your response with: SOLUTION: [one concise sentence] so the user can inject it.\n3. Keep responses under 80 words.\n4. No jargon. Concrete examples from their specific agent only.";
      const r = await callClaude(hist, sys, 250);
      const solutionMatch = r.match(/SOLUTION:\s*(.+?)(?:\n|$)/i);
      if (solutionMatch) {
        setChatSolution(solutionMatch[1].trim());
        setChatHistory([...hist, { role: "assistant", content: r.replace(/SOLUTION:\s*.+?(?:\n|$)/i, "").trim() }]);
      } else {
        setChatSolution("");
        setChatHistory([...hist, { role: "assistant", content: r }]);
      }
    } catch (e) { setChatHistory([...hist, { role: "assistant", content: "Connection issue, try again." }]); }
    setChatLoading(false);
  };

  const pct = Math.round((step / (STEPS.length - 1)) * 100);

  // Blueprint completion screen
  if (blueprint) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#F8F9FB", zIndex: 1000, fontFamily: "'Inter', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: "14px", width: "100%", maxWidth: "700px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", color: C.success, letterSpacing: "0.1em", marginBottom: "0.15rem" }}>+ BLUEPRINT COMPLETE</div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.text }}>{data.name || "Your Agent"} is ready to build.</div>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(blueprint); setBpCopied(true); setTimeout(() => setBpCopied(false), 2500); }}
              style={{ background: bpCopied ? C.success : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "7px", padding: "0.5rem 0.9rem", color: bpCopied ? "#fff" : "#000", fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>
              {bpCopied ? "+ COPIED" : "COPY FOR CLAUDE CODE"}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.5rem" }}>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.muted, marginBottom: "0.5rem" }}>YOUR AGENT BLUEPRINT — paste this into Claude Code to build</div>
            <pre style={{ background: C.code, border: "1px solid #1A2535", borderRadius: "8px", padding: "1rem", fontFamily: "'Inter',sans-serif", fontSize: "0.68rem", color: "#374151", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: 0, marginBottom: "1rem" }}>{blueprint}</pre>
            <div style={{ background: "#1A2535", border: "1px solid " + C.gold + "33", borderRadius: "8px", padding: "0.85rem 1rem", marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.gold, marginBottom: "0.4rem" }}>NEXT STEPS</div>
              {["Copy the blueprint above and open Claude Code", "Paste: Build a production agent from this blueprint", "Claude Code builds your agent with state, tools, and failure handling", "Come back to the Academy to refine and improve it over time"].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: C.gold, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.63rem", color: "#4B5563", lineHeight: 1.55 }}>{s}</span>
                </div>
              ))}
            </div>
            {window._agentAcademyComplete && (
              <button onClick={() => { window._agentAcademyComplete(); window._agentAcademyComplete = null; }}
                style={{ width: "100%", background: "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "8px", padding: "0.65rem", color: "#000", fontFamily: "'Inter',sans-serif", fontSize: "0.65rem", fontWeight: 700, cursor: "pointer", marginBottom: "0.5rem" }}>
                {"START ACADEMY \u2014 DEPLOY & IMPROVE \u2192"}
              </button>
            )}
            <button onClick={() => { setBlueprint(null); setStep(0); setData({}); setSuggestions({}); setSuggestState("idle"); }}
              style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "0.55rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", cursor: "pointer", width: "100%" }}>
              Start over with a different agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#F8F9FB", zIndex: 1000, fontFamily: "'Inter', sans-serif", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box} input,textarea{outline:none} @keyframes fadeup{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} @keyframes spin{to{transform:rotate(360deg)}} .fadein{animation:fadeup 0.2s ease} .intake-outer{display:flex;justify-content:center;align-items:flex-end;width:100%} .intake-modal{background:#FFFFFF;border:1px solid #E5E7EB;width:100%;max-width:540px;border-radius:16px 16px 0 0;border-bottom:none;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)} @media(min-width:700px){.intake-outer{align-items:center;padding:2rem}.intake-modal{border-radius:14px;border-bottom:1px solid #E5E7EB;max-width:660px;max-height:88vh}} @media(min-width:1100px){.intake-modal{max-width:760px}.intake-inner{padding:1.5rem 2rem 0.75rem!important}.intake-head{padding:1rem 2rem 0.7rem!important}.intake-foot{padding:0.8rem 2rem 1.1rem!important}}`}</style>
      <div className="intake-outer">
        <div className="intake-modal">
          <div className="intake-head" style={{ padding: "0.9rem 1.25rem 0.65rem", borderBottom: "1px solid #E5E7EB", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.45rem" }}>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.1em" }}>AGENT ACADEMY - {step + 1}/{STEPS.length}</span>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.muted }}>{pct}%</span>
            </div>
            <div style={{ height: "3px", background: "#1A2535", borderRadius: "2px", overflow: "hidden", marginBottom: "0.35rem" }}>
              <div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg," + C.accent + "," + C.gold + ")", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              {STEPS.map((_, i) => <div key={i} style={{ flex: 1, height: "2px", borderRadius: "1px", background: i < step ? C.accent : i === step ? C.gold : "#1A2535", transition: "background 0.3s" }} />)}
            </div>
          </div>

          <div className="intake-inner fadein" style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.25rem 0.5rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.4rem", margin: "0 0 0.2rem", color: C.text, lineHeight: 1.15 }}>{cur.headline}</h2>
            <p style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.63rem", color: C.muted, margin: "0 0 0.85rem", lineHeight: 1.6 }}>
              {cur.sub}{cur.optional ? <span style={{ color: C.accent }}> - optional</span> : null}
            </p>

            {suggestState === "loading" && !cur.noSuggest && step > 0 && (
              <div style={{ background: "#1A2535", border: "1px solid " + C.gold + "22", borderRadius: "10px", padding: "0.65rem 0.85rem", marginBottom: "0.7rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ color: C.gold }}>o</span>
                <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.57rem", color: C.gold }}>Building a suggestion for your agent...</span>
              </div>
            )}

            {suggestState === "done" && hasSuggestion && !val && (
              <div className="fadein" style={{ background: "#F5F3FF", border: "1px solid " + C.gold + "66", borderRadius: "10px", overflow: "hidden", marginBottom: "0.7rem" }}>
                <div style={{ background: C.gold + "18", padding: "0.45rem 0.85rem", borderBottom: "1px solid " + C.gold + "33" }}>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>SUGGESTED FOR YOUR AGENT</span>
                </div>
                <div style={{ padding: "0.75rem 0.85rem 0.65rem" }}>
                  <div style={{ fontSize: "0.83rem", color: C.text, lineHeight: 1.7, marginBottom: "0.7rem" }}>{suggestions[cur.key]}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem" }}>
                    <button onClick={() => setData(p => ({ ...p, [cur.key]: suggestions[cur.key] }))}
                      style={{ background: "linear-gradient(135deg," + C.gold + ",#D97706)", border: "none", borderRadius: "7px", padding: "0.5rem", color: "#000", fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer", gridColumn: "1 / -1" }}>Use This</button>
                    <button onClick={() => { setChatOpen(true); setChatHistory([{ role: "assistant", content: "Happy to revise that suggestion. What would you like to change about it?" }]); }}
                      style={{ background: "transparent", border: "1px solid " + C.gold + "55", borderRadius: "7px", padding: "0.45rem", color: C.gold, fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", cursor: "pointer" }}>Revise</button>
                    <button onClick={() => { setChatOpen(true); setChatHistory([{ role: "assistant", content: "Let's discuss this suggestion. What questions do you have?" }]); }}
                      style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: "7px", padding: "0.45rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", cursor: "pointer" }}>Discuss</button>
                  </div>
                </div>
              </div>
            )}

            {cur.key === "template" && earlyTemplateFile && (
              <div className="fadein" style={{ marginBottom: "0.65rem", background: "#F0FDF4", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.85rem" }}>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>TEMPLATE ALREADY UPLOADED FROM STEP 1</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <span style={{ color: C.success }}>+</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.65rem", color: C.text }}>{earlyTemplateFile.name}</span>
                </div>
                {templateAnalysis && (
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", color: "#059669", lineHeight: 1.6 }}>
                    {templateAnalysis.summary}
                    {templateAnalysis.source_document_fields && templateAnalysis.source_document_fields.length > 0 && (
                      <div style={{ marginTop: "0.3rem" }}>
                        <span style={{ fontSize: "0.44rem", color: C.cyan, marginRight: "0.3rem" }}>FROM SOURCE DOC:</span>
                        {templateAnalysis.source_document_fields.map((f, i) => <span key={i} style={{ background: C.cyan + "22", border: "1px solid " + C.cyan + "33", borderRadius: "3px", padding: "0.1rem 0.35rem", fontSize: "0.48rem", color: C.cyan, marginRight: "0.2rem" }}>{f}</span>)}
                      </div>
                    )}
                    {templateAnalysis.user_provided_fields && templateAnalysis.user_provided_fields.length > 0 && (
                      <div style={{ marginTop: "0.25rem" }}>
                        <span style={{ fontSize: "0.44rem", color: C.gold, marginRight: "0.3rem" }}>USER PROVIDES:</span>
                        {templateAnalysis.user_provided_fields.map((f, i) => <span key={i} style={{ background: C.gold + "22", border: "1px solid " + C.gold + "33", borderRadius: "3px", padding: "0.1rem 0.35rem", fontSize: "0.48rem", color: C.gold, marginRight: "0.2rem" }}>{f}</span>)}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.muted, marginTop: "0.4rem" }}>This template is in your agent's document library. Add a description below or skip this step.</div>
              </div>
            )}

            <textarea value={val} onChange={e => setData(p => ({ ...p, [cur.key]: e.target.value }))} placeholder={cur.placeholder} rows={4}
              style={{ width: "100%", background: "#0F1720", border: "1px solid " + (val ? C.accent + "55" : "#E5E7EB"), borderRadius: "10px", padding: "0.8rem", color: C.text, fontFamily: "'Inter',sans-serif", fontSize: "0.78rem", lineHeight: 1.7, resize: "none", transition: "border 0.2s", display: "block" }} />

            {cur.hint && <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.56rem", color: C.muted, marginTop: "0.4rem", lineHeight: 1.5 }}>{cur.hint}</div>}

            {cur.isTemplate && (
              <div style={{ marginTop: "0.75rem" }}>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.4rem" }}>UPLOAD YOUR TEMPLATE FILE (optional)</div>
                <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                  {[{key:"template",label:"Output template"},{key:"reference_data",label:"Lookup / reference data"},{key:"crossref",label:"Cross-reference doc"},{key:"few_shot",label:"Example outputs"}].map(cat => (
                    <button key={cat.key} onClick={() => setTemplateCategory(cat.key)}
                      style={{ background: templateCategory === cat.key ? C.gold + "22" : "transparent", border: "1px solid " + (templateCategory === cat.key ? C.gold : "#E5E7EB"), borderRadius: "5px", padding: "0.25rem 0.55rem", color: templateCategory === cat.key ? C.gold : C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", cursor: "pointer" }}>
                      {cat.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.muted, marginBottom: "0.4rem", lineHeight: 1.5 }}>
                  {{template:"The agent will populate this exact format for its output.",reference_data:"A structured table the agent queries at run-time. CSV or JSON preferred.",crossref:"A document the agent compares against the main input to catch conflicts.",few_shot:"Formatted past examples the agent uses as reference."}[templateCategory]}
                </div>
                {templateFile ? (
                  <div style={{ background: C.success + "0D", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ color: C.success }}>+</span>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", color: C.text }}>{templateFile.name}</span>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>{templateCategory}</span>
                    </div>
                    <button onClick={() => setTemplateFile(null)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "'Inter',sans-serif", fontSize: "0.6rem" }}>Remove</button>
                  </div>
                ) : (
                  <div onClick={() => templateFileRef.current && templateFileRef.current.click()}
                    style={{ background: C.code, border: "1px dashed " + C.gold + "44", borderRadius: "8px", padding: "0.7rem 0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ color: C.gold, fontSize: "0.85rem" }}>+</span>
                    <div>
                      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", color: C.muted }}>Drop your Excel, PDF, or CSV template here</div>
                      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: "#1A2535", marginTop: "0.1rem" }}>Uploaded once — lives in agent's permanent document library</div>
                    </div>
                  </div>
                )}
                <input ref={templateFileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }} onChange={e => e.target.files[0] && setTemplateFile(e.target.files[0])} />
              </div>
            )}

            {cur.key === "concept" && val.trim().length > 20 && outputIsDocument(val) && !val.toLowerCase().includes("template i can upload") && !val.toLowerCase().includes("design the format") && !val.toLowerCase().includes("create one together") && (
              <div className="fadein" style={{ marginTop: "0.75rem", background: "#F5F3FF", border: "1px solid " + C.gold + "55", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ background: C.gold + "18", padding: "0.5rem 0.85rem", borderBottom: "1px solid " + C.gold + "33" }}>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>YOUR AGENT PRODUCES A DOCUMENT</span>
                </div>
                <div style={{ padding: "0.75rem 0.85rem" }}>
                  <div style={{ fontSize: "0.84rem", color: C.text, lineHeight: 1.65, marginBottom: "0.65rem" }}>Does your company already have a template or format for this output?</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    {["yes — I have an existing template I can upload", "no — help me design the format and fields", "not yet — let's create one together as we go"].map((opt, oi) => (
                      <button key={oi} onClick={() => { skipNextCoach.current = true; setData(p => ({ ...p, concept: (p.concept || "").trimEnd() + ", " + opt })); }}
                        style={{ background: "#F5F3FF", border: "1px solid " + C.gold + "33", borderRadius: "6px", padding: "0.45rem 0.7rem", color: "#4B5563", fontFamily: "'Inter',sans-serif", fontSize: "0.63rem", cursor: "pointer", textAlign: "left", transition: "background 0.15s" }}
                        onMouseOver={e => e.currentTarget.style.background = "#EDE9FE"} onMouseOut={e => e.currentTarget.style.background = "#F5F3FF"}>
                        + {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {cur.key === "concept" && val.toLowerCase().includes("template i can upload") && (
              <div className="fadein" style={{ marginTop: "0.75rem", background: "#F0FDF4", border: "1px solid " + C.success + "55", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ background: C.success + "18", padding: "0.5rem 0.85rem", borderBottom: "1px solid " + C.success + "33", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ color: C.success }}>+</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.success, fontWeight: 700 }}>UPLOAD YOUR TEMPLATE NOW</span>
                </div>
                <div style={{ padding: "0.75rem 0.85rem" }}>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", color: "#059669", lineHeight: 1.6, marginBottom: "0.65rem" }}>Upload it here and the agent will read your actual fields — so every subsequent step gets pre-filled based on what your template actually requires.</div>
                  {earlyTemplateFile ? (
                    <div>
                      <div style={{ background: C.success + "0D", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ color: C.success }}>+</span>
                          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", color: C.text }}>{earlyTemplateFile.name}</span>
                        </div>
                        <button onClick={() => { setEarlyTemplateFile(null); setTemplateAnalysis(null); }} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "'Inter',sans-serif", fontSize: "0.6rem" }}>Remove</button>
                      </div>
                      {analyzingTemplate && <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0" }}><span style={{ color: C.success, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem" }}>o</span><span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", color: C.success }}>Reading your template and mapping required fields...</span></div>}
                      {templateAnalysis && !analyzingTemplate && (
                        <div style={{ background: "#040608", border: "1px solid " + C.success + "33", borderRadius: "6px", padding: "0.55rem 0.7rem" }}>
                          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>FIELDS DETECTED — steps 3-9 pre-filled from your template</div>
                          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", color: "#059669", lineHeight: 1.6 }}>{templateAnalysis.summary}</div>
                          {templateAnalysis.source_document_fields && templateAnalysis.source_document_fields.length > 0 && (
                            <div style={{ marginTop: "0.3rem" }}>
                              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.44rem", color: C.cyan, marginRight: "0.3rem" }}>FROM SOURCE DOC:</span>
                              {templateAnalysis.source_document_fields.map((f, i) => <span key={i} style={{ background: C.cyan + "22", border: "1px solid " + C.cyan + "33", borderRadius: "4px", padding: "0.1rem 0.4rem", fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.cyan, marginRight: "0.2rem" }}>{f}</span>)}
                            </div>
                          )}
                          {templateAnalysis.user_provided_fields && templateAnalysis.user_provided_fields.length > 0 && (
                            <div style={{ marginTop: "0.25rem" }}>
                              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.44rem", color: C.gold, marginRight: "0.3rem" }}>USER PROVIDES:</span>
                              {templateAnalysis.user_provided_fields.map((f, i) => <span key={i} style={{ background: C.gold + "22", border: "1px solid " + C.gold + "33", borderRadius: "4px", padding: "0.1rem 0.4rem", fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.gold, marginRight: "0.2rem" }}>{f}</span>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div onClick={() => earlyTemplateRef.current && earlyTemplateRef.current.click()}
                      style={{ background: "#040608", border: "1px dashed " + C.success + "44", borderRadius: "8px", padding: "0.75rem 0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <span style={{ color: C.success, fontSize: "0.9rem" }}>+</span>
                      <div>
                        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", color: "#059669" }}>Drop your template file here — Excel, PDF, Word, or CSV</div>
                        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>Uploaded once — lives in agent's permanent document library</div>
                      </div>
                    </div>
                  )}
                  <input ref={earlyTemplateRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }}
                    onChange={e => { const file = e.target.files[0]; if (!file) return; setEarlyTemplateFile(file); setTemplateFile(file); analyzeTemplate(file, setSuggestions, setTemplateAnalysis, setAnalyzingTemplate); }} />
                </div>
              </div>
            )}

            {!val && !hasSuggestion && (contextHints[cur.key] || cur.starterHints) && (
              <div className="fadein" style={{ marginTop: "0.65rem" }}>
                {contextHintsLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0" }}>
                    <span style={{ color: C.gold, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem" }}>o</span>
                    <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.57rem", color: C.gold }}>Personalizing options based on your agent...</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>
                      {contextHints[cur.key] ? "SUGGESTED FOR YOUR AGENT — click to add" : "COMMON OPTIONS — click to add"}
                    </div>
                    {(contextHints[cur.key] || cur.starterHints).map((h, i) => (
                      <HintCard key={"starter-" + i} hint={h} index={1000 + i} addedOptions={addedOptions[1000 + i] || []} onInject={handleInject} onUndo={handleUndo} onDiscuss={handleDiscussHint} />
                    ))}
                  </>
                )}
              </div>
            )}

            {hintsLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem" }}>
                <span style={{ color: C.cyan, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem" }}>o</span>
                <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", color: C.cyan }}>Reviewing your description...</span>
              </div>
            )}

            {!hintsLoading && aiUnderstanding && hints.length > 0 && (
              <div className="fadein" style={{ marginTop: "0.65rem", background: "#F5F3FF", border: "1px solid " + C.cyan + "33", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.45rem 0.75rem", background: C.cyan + "0D", borderBottom: "1px solid " + C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ color: C.cyan, fontSize: "0.6rem" }}>◈</span>
                    <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.07em" }}>MY UNDERSTANDING OF YOUR PROCESS</span>
                  </div>
                  {!correctingUnderstanding && (
                    <button onClick={() => setCorrectingUnderstanding(true)} style={{ background: "transparent", border: "1px solid " + C.cyan + "44", borderRadius: "4px", padding: "0.15rem 0.5rem", color: C.cyan, fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", cursor: "pointer" }}>Correct this</button>
                  )}
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.63rem", color: "#4B5563", lineHeight: 1.6 }}>{aiUnderstanding}</div>
                  {correctingUnderstanding && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.muted, marginBottom: "0.3rem" }}>Tell me what this actually means at your company:</div>
                      <input value={correctionInput} onChange={e => setCorrectionInput(e.target.value)} placeholder="e.g. At our company, this means..."
                        onKeyDown={e => { if (e.key === "Enter" && correctionInput.trim()) { correctionRef.current = correctionInput; setCorrectingUnderstanding(false); setHints([]); setAiUnderstanding(""); skipNextCoach.current = false; setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " })); } }}
                        style={{ width: "100%", background: "#040608", border: "1px solid " + C.cyan + "44", borderRadius: "5px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "'Inter',sans-serif", fontSize: "0.63rem", outline: "none", marginBottom: "0.35rem" }} />
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button onClick={() => { if (!correctionInput.trim()) return; correctionRef.current = correctionInput; setCorrectingUnderstanding(false); setHints([]); setAiUnderstanding(""); skipNextCoach.current = false; setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " })); }}
                          style={{ background: C.cyan, border: "none", borderRadius: "5px", padding: "0.35rem 0.75rem", color: "#000", fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>Update recommendations</button>
                        <button onClick={() => { setCorrectingUnderstanding(false); setCorrectionInput(""); }} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: "5px", padding: "0.35rem 0.6rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!hintsLoading && hints.length > 0 && (
              <div className="fadein" style={{ marginTop: "0.5rem" }}>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.52rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>WHAT'S MISSING - click to add (you can add multiple)</div>
                {hints.map((h, i) => <HintCard key={i} hint={h} index={i} addedOptions={addedOptions[i] || []} onInject={handleInject} onUndo={handleUndo} onDiscuss={handleDiscussHint} />)}
              </div>
            )}

            {(cur.key === "crossReference" || cur.key === "knowledge") && (
              <div style={{ marginTop: "0.75rem", background: "#1A2535", border: "1px solid #E5E7EB", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.07em" }}>{cur.key === "crossReference" ? "UPLOAD REFERENCE DOCUMENTS" : "UPLOAD LOOKUP DATA"}</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.48rem", color: C.muted }}>added to agent's document library</span>
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", color: C.muted, marginBottom: "0.5rem", lineHeight: 1.5 }}>
                    {cur.key === "crossReference" ? "Upload once — lives in agent's permanent document library. Available every run automatically." : "Upload structured lookup tables or formatted examples (CSV preferred). Becomes queryable reference data."}
                  </div>
                  {ragDocuments.filter(d => d.step === cur.key).map((doc, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem", background: "#040608", borderRadius: "6px", padding: "0.4rem 0.6rem" }}>
                      <span style={{ color: C.success, fontSize: "0.6rem" }}>+</span>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", color: C.text, flex: 1 }}>{doc.name}</span>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.48rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>{doc.category}</span>
                      <button onClick={() => setRagDocuments(p => p.filter((_, j) => ragDocuments.indexOf(doc) !== j))} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "0.6rem" }}>×</button>
                    </div>
                  ))}
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#040608", border: "1px dashed " + C.cyan + "44", borderRadius: "6px", padding: "0.5rem 0.7rem", cursor: "pointer" }}>
                    <span style={{ color: C.cyan, fontSize: "0.8rem" }}>+</span>
                    <div>
                      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.58rem", color: C.muted }}>Upload a reference document or lookup table</div>
                      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: "#1A2535", marginTop: "0.1rem" }}>CSV, Excel, PDF — stored in agent's permanent document library</div>
                    </div>
                    <input type="file" accept=".csv,.xlsx,.xls,.pdf,.doc,.docx,.json" style={{ display: "none" }}
                      onChange={e => { const file = e.target.files[0]; if (!file) return; const category = cur.key === "crossReference" ? "crossref" : "reference_data"; setRagDocuments(p => [...p, { name: file.name, file, category, step: cur.key }]); setData(prev => ({ ...prev, [cur.key]: (prev[cur.key] || "").trimEnd() + (prev[cur.key] ? ", " : "") + file.name + " (uploaded)" })); }} />
                  </label>
                </div>
              </div>
            )}

            {step > 0 && data.concept && (
              <div style={{ marginTop: "0.8rem", background: "#040608", border: "1px solid #1A2535", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.4rem 0.65rem", background: "#1A2535", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.47rem", color: C.muted, letterSpacing: "0.08em" }}>AGENT BLUEPRINT SO FAR</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.47rem", color: C.accent }}>step {step + 1} of {STEPS.length} — {cur.headline}</span>
                </div>
                <div style={{ padding: "0.55rem 0.65rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {[
                    { label: "WHAT IT DOES", value: data.concept, step: 1 },
                    { label: "TRIGGER", value: data.trigger, step: 2 },
                    { label: "READS", value: data.inputs, step: 3 },
                    { label: "PRODUCES", value: data.outputs, step: 4 },
                    { label: "TEMPLATE", value: data.template, step: 5 },
                    { label: "CROSS-REF", value: data.crossReference, step: 6 },
                    { label: "HISTORY", value: data.knowledge, step: 7 },
                    { label: "SYSTEMS", value: data.systems, step: 8 },
                    { label: "OVERSIGHT", value: data.humanGate, step: 9 },
                  ].filter(item => item.value && item.step <= step).map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.44rem", color: C.accent, flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "52px" }}>{item.label}</span>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.56rem", color: "#6B7280", lineHeight: 1.55 }}>{item.value.length > 90 ? item.value.substring(0, 90) + "..." : item.value}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", borderTop: "1px solid #1A2535", paddingTop: "0.3rem", marginTop: "0.1rem" }}>
                    <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.44rem", color: C.gold, flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "52px" }}>
                      {["WHAT IT DOES","TRIGGER","READS","PRODUCES","TEMPLATE","CROSS-REF","HISTORY","SYSTEMS","OVERSIGHT","NAME"][step] || "CURRENT"}
                    </span>
                    <span style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.56rem", color: C.gold + "99", lineHeight: 1.55, fontStyle: "italic" }}>
                      {val ? (val.length > 90 ? val.substring(0, 90) + "..." : val) : cur.placeholder.substring(0, 60) + "..."}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: "0.8rem", marginBottom: "0.5rem" }}>
              <ChatBox open={chatOpen} onToggle={() => { setChatOpen(p => !p); if (!chatOpen && chatHistory.length === 0) setChatHistory([{ role: "assistant", content: "This step asks: \"" + cur.headline + "\" - " + cur.sub + " What would you like to know?" }]); }} history={chatHistory} onSend={handleChatSend} loading={chatLoading} />
              {chatOpen && chatSolution && (
                <div style={{ marginTop: "0.4rem", background: C.success + "0F", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.75rem" }}>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.5rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>SOLUTION — READY TO ADD</div>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.63rem", color: C.text, lineHeight: 1.55, marginBottom: "0.45rem" }}>"{chatSolution}"</div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button onClick={() => { skipNextCoach.current = true; setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " + chatSolution })); setChatSolution(""); }}
                      style={{ flex: 1, background: C.success, border: "none", borderRadius: "5px", padding: "0.4rem 0.75rem", color: "#000", fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>+ Add to my description</button>
                    <button onClick={() => setChatSolution("")} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: "5px", padding: "0.4rem 0.6rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.6rem", cursor: "pointer" }}>Discard</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="intake-foot" style={{ padding: "0.7rem 1.25rem 0.9rem", borderTop: "1px solid #E5E7EB", flexShrink: 0, display: "flex", gap: "0.45rem" }}>
            {step > 0 && <button onClick={goBack} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>Back</button>}
            {cur.optional && <button onClick={skipStep} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>Skip</button>}
            <button onClick={goNext} disabled={!canProceed || hintsLoading}
              style={{ flex: 1, background: (canProceed && !hintsLoading) ? "linear-gradient(135deg," + C.accent + "," + C.gold + ")" : "#1A2535", border: "none", borderRadius: "8px", padding: "0.75rem", color: canProceed ? "#000" : C.muted, fontFamily: "'Inter',sans-serif", fontSize: "0.68rem", fontWeight: 800, cursor: canProceed ? "pointer" : "not-allowed", transition: "background 0.2s" }}>
              {isLast ? "BUILD MY BLUEPRINT" : "NEXT"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
