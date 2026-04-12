import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
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
  const m = s.match(/[\[{][\s\S]*[\]}]/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
};

const getFallback = (concept, key) => {
  const l = (concept || "").toLowerCase();
  const isConstruction = l.includes("submittal") || l.includes("construction") || l.includes("rfi");
  const isEmail = l.includes("email") || l.includes("inbox");
  if (isConstruction) {
    const m = {
      trigger: "New project kickoff (primary). Secondary triggers: specification bulletin received, addendum issued, or manually started by the user.",
      inputs: "Specification PDFs (all relevant divisions), project name, and any bulletins or addenda issued after contract award.",
      outputs: "Formatted Excel submittal log with item number, spec section, description, submittal type, required-by date, and status columns.",
      knowledge: "Past submittal logs from similar projects and spec section naming conventions.",
      systems: "A shared folder for spec storage and a spreadsheet tool for the output log.",
      humanGate: "Before delivering the log to any external party, and whenever it finds a spec section it cannot parse or a conflict between documents.",
    };
    return m[key] || "";
  }
  if (isEmail) {
    const m = {
      trigger: "When a new email arrives matching defined criteria — sender, subject keyword, or attachment type.",
      inputs: "Email subject, sender name, full body text, and any attachments.",
      outputs: "A draft reply staged in drafts for review, plus a Slack notification that it is ready.",
      knowledge: "Past email threads with the same sender, standard response templates.",
      systems: "Gmail or Outlook (read and draft), Slack (notify when ready).",
      humanGate: "Before sending any reply externally, and when the email topic is sensitive or requires judgment it doesn't have context for.",
    };
    return m[key] || "";
  }
  const generic = {
    trigger: "When I manually start it, or when a specific file or message arrives.",
    inputs: "The data, documents, or requests the agent needs to read before it can begin.",
    outputs: "A completed document, updated record, or action taken in another system.",
    knowledge: "Structured lookup tables it queries (approved lists, pricing, substitutions) and formatted past examples it follows — not prose documents.",
    systems: "The specific apps or databases the agent reads from or writes to.",
    humanGate: "Before taking any irreversible action, sending anything externally, or when confidence in the result is low.",
  };
  return generic[key] || "";
};

const buildContext = (data) => {
  const parts = [];
  if (data.concept) parts.push("CONCEPT: " + data.concept);
  if (data.trigger) parts.push("TRIGGER: " + data.trigger);
  if (data.inputs) parts.push("INPUTS: " + data.inputs);
  if (data.outputs) parts.push("OUTPUTS: " + data.outputs);
  if (data.template) parts.push("OUTPUT TEMPLATE: " + data.template);
  if (data.crossReference) parts.push("CROSS-REFERENCE DOCS: " + data.crossReference);
  if (data.knowledge) parts.push("HISTORICAL KNOWLEDGE: " + data.knowledge);
  if (data.systems) parts.push("SYSTEMS: " + data.systems);
  if (data.humanGate) parts.push("HUMAN OVERSIGHT: " + data.humanGate);
  return parts.join("\n");
};

const getFallbackHints = (stepKey, concept) => {
  const l = (concept || "").toLowerCase();
  const maps = {
    concept: [
      { gap: "What starts the agent running?", options: ["when I manually upload a file or document", "when I receive an email with relevant content", "on a daily or weekly schedule"] },
      { gap: "What does it produce when finished?", options: ["a formatted spreadsheet or report", "a draft document ready for my review", "an updated record in an existing system"] },
      { gap: "What should happen when the source data changes?", options: ["re-run automatically when source files are updated", "alert me and ask whether to re-run", "produce a change summary showing what's different"] },
    ],
    templatePrompt: [
      { gap: "Does your company already have a template for this output?", options: ["yes, I have an existing template I can upload", "no, I need help designing the format and fields", "I don't have one yet but want to create one together"] },
    ],
    trigger: [
      { gap: "What is the primary trigger?", options: ["when I manually start it by uploading a file", "on a daily schedule at a set time", "when a specific email arrives"] },
      { gap: "Are there secondary triggers?", options: ["also when a document is updated or replaced", "also when I request a manual refresh", "also when a new project folder is created"] },
    ],
    inputs: [
      { gap: "What files or documents does it read?", options: ["PDF documents uploaded manually", "files in a specific shared folder", "email attachments of a specific type"] },
      { gap: "What metadata or context does it need?", options: ["the project name and responsible party", "the date range or version number", "who initiated the request"] },
    ],
    outputs: [
      { gap: "What format is the output?", options: ["an Excel spreadsheet with structured columns", "a PDF report formatted for sharing", "a record entered into an existing system"] },
      { gap: "Where does the output go?", options: ["saved to a shared folder I specify", "emailed to me as an attachment", "uploaded to a project management tool"] },
    ],
    systems: [
      { gap: "Where does it read input from?", options: ["a shared folder I can drop files into", "my email inbox", "a specific cloud storage folder"] },
      { gap: "Where does it deliver output?", options: ["a shared Box or Google Drive folder", "email as an attachment", "a Slack channel notification"] },
    ],
    humanGate: [
      { gap: "Before sending anything externally", options: ["before emailing or sharing any output", "before uploading to any shared folder", "before notifying any external parties"] },
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
    if (csv.trim()) {
      lines.push(`=== Sheet: ${name} ===`);
      lines.push(csv);
    }
  }
  return lines.join("\n");
};

const analyzeTemplate = async (file, setSuggestions, setAnalysis, setAnalyzing) => {
  setAnalyzing(true);
  try {
    let messages;
    const isXlsx = file.name.match(/\.xlsx?$/i);
    const isPdf = file.type === "application/pdf";
    const prompt = "This is a form or template that an AI agent will fill out. Analyze it and return JSON only:\n{\"fields\": [\"field name 1\", \"field name 2\", ...],\"required_inputs\": \"one sentence describing what data the user must provide to fill this form\",\"trigger\": \"one sentence describing when someone would typically fill out this form\",\"outputs\": \"one sentence describing what the completed form looks like and where it goes\",\"humanGate\": \"one sentence describing when a human should review before submitting\",\"summary\": \"one sentence describing what this form is for\"}";

    if (isPdf) {
      const reader = new FileReader();
      const fileContent = await new Promise((resolve, reject) => {
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const b64 = fileContent.split(",")[1];
      messages = [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: prompt }
        ]
      }];
    } else if (isXlsx) {
      // Parse xlsx with SheetJS — extract all sheets as CSV text
      const xlsxText = await readXlsxAsText(file);
      messages = [{
        role: "user",
        content: "This is the content of an Excel template (all sheets extracted as CSV):\n\n" + xlsxText.substring(0, 4000) + "\n\n" + prompt
      }];
    } else {
      const reader = new FileReader();
      const fileContent = await new Promise((resolve, reject) => {
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });
      messages = [{
        role: "user",
        content: "This is a form or template that an AI agent will fill out:\n\n" + fileContent.substring(0, 3000) + "\n\n" + prompt
      }];
    }

    const raw = await callClaude(messages, "", 600);
    const analysis = parseJSON(raw);
    if (analysis) {
      setAnalysis(analysis);
      setSuggestions(prev => ({
        ...prev,
        inputs: analysis.required_inputs || prev.inputs,
        trigger: analysis.trigger || prev.trigger,
        outputs: analysis.outputs || prev.outputs,
        humanGate: analysis.humanGate || prev.humanGate,
      }));
    }
  } catch (e) { console.error("Template analysis failed:", e); }
  setAnalyzing(false);
};

const getDomainContext = (text) => {
  const l = text.toLowerCase();

  // Construction / MEP
  if (l.includes("submittal log") || l.includes("submittal register"))
    return "DOMAIN FACT: A submittal log is an OUTPUT built by reading construction SPECIFICATION documents (spec PDFs, Division sections). Input = spec docs. Output = the log. Triggers: new project start, spec uploaded, bulletin/addendum received. Do not suggest submittals as inputs. For knowledge/reference steps: approved products lists should be structured lookup tables (JSON/CSV), not prose PDFs. Past submittal logs should be formatted as structured examples, not raw uploads.";
  if (l.includes("rfi") || (l.includes("change order") && l.includes("construction")))
    return "DOMAIN FACT: RFI/change order agents read RFI documents and contract terms (inputs) and produce impact analysis memos or notice letters (outputs).";
  if (l.includes("punch list"))
    return "DOMAIN FACT: Punch list agents read inspection notes or site photos (inputs) and produce a formatted punch list document (output).";

  // Legal / contracts
  if (l.includes("contract review") || l.includes("contract analysis"))
    return "DOMAIN FACT: Contract review agents read contract documents (inputs) and produce risk summaries, redlines, or clause extractions (outputs). They do not modify the original contract.";
  if (l.includes("invoice") && (l.includes("extract") || l.includes("process") || l.includes("review")))
    return "DOMAIN FACT: Invoice processing agents read invoice PDFs or emails (inputs) and produce structured data records, approval requests, or accounting entries (outputs).";
  if (l.includes("lease") && (l.includes("abstract") || l.includes("review") || l.includes("extract")))
    return "DOMAIN FACT: Lease abstraction agents read lease documents (inputs) and produce structured summaries of key terms like dates, rent, options, and obligations (outputs).";

  // Healthcare / medical
  if (l.includes("medical record") || l.includes("patient record") || l.includes("clinical note"))
    return "DOMAIN FACT: Medical record agents read clinical documents, notes, or lab results (inputs) and produce structured summaries, coded entries, or alerts (outputs).";
  if (l.includes("prior auth") || l.includes("prior authorization"))
    return "DOMAIN FACT: Prior authorization agents read clinical criteria and patient records (inputs) and produce authorization requests or approval/denial decisions (outputs).";

  // Sales / CRM
  if (l.includes("lead") && (l.includes("qualify") || l.includes("score") || l.includes("enrich")))
    return "DOMAIN FACT: Lead qualification agents read prospect data, website visits, or form submissions (inputs) and produce scored/enriched lead records or routed assignments (outputs).";
  if (l.includes("proposal") && (l.includes("generat") || l.includes("creat") || l.includes("draft") || l.includes("build")))
    return "DOMAIN FACT: Proposal generation agents read deal data, product catalogs, and client requirements (inputs) and produce formatted proposal documents (outputs).";
  if (l.includes("crm") && (l.includes("update") || l.includes("sync") || l.includes("log")))
    return "DOMAIN FACT: CRM update agents read emails, call transcripts, or meeting notes (inputs) and produce structured CRM field updates or activity logs (outputs).";

  // Finance / accounting
  if (l.includes("expense") && (l.includes("report") || l.includes("approv") || l.includes("process")))
    return "DOMAIN FACT: Expense agents read receipts, credit card statements, or expense forms (inputs) and produce categorized expense reports or approval requests (outputs).";
  if (l.includes("reconcil"))
    return "DOMAIN FACT: Reconciliation agents read two or more data sources like bank statements and accounting records (inputs) and produce a discrepancy report or matched/unmatched transaction list (outputs).";
  if (l.includes("financial report") || l.includes("financial statement"))
    return "DOMAIN FACT: Financial reporting agents read raw transaction data or accounting records (inputs) and produce formatted financial statements or summaries (outputs).";

  // HR / recruiting
  if (l.includes("resum") || l.includes("cv") && (l.includes("screen") || l.includes("review") || l.includes("rank")))
    return "DOMAIN FACT: Resume screening agents read job descriptions and candidate resumes (inputs) and produce ranked shortlists, fit scores, or rejection/advance recommendations (outputs).";
  if (l.includes("onboard"))
    return "DOMAIN FACT: Onboarding agents read new hire data and company policy documents (inputs) and produce checklists, task assignments, or welcome communications (outputs).";

  // Customer support
  if (l.includes("ticket") && (l.includes("triage") || l.includes("route") || l.includes("classif") || l.includes("priorit")))
    return "DOMAIN FACT: Ticket triage agents read incoming support tickets (inputs) and produce classified, prioritized, and routed ticket assignments (outputs). They do not resolve tickets — they direct them.";
  if (l.includes("support") && (l.includes("draft") || l.includes("reply") || l.includes("response")))
    return "DOMAIN FACT: Support response agents read customer messages and knowledge base articles (inputs) and produce draft replies for human review (outputs).";

  // Email / inbox
  if ((l.includes("email") || l.includes("inbox")) && (l.includes("draft") || l.includes("reply") || l.includes("response") || l.includes("triage")))
    return "DOMAIN FACT: Email agents read incoming emails and context (inputs) and produce draft replies or triage decisions (outputs). They do not send without human approval.";

  // Research
  if (l.includes("research") && (l.includes("report") || l.includes("summary") || l.includes("brief") || l.includes("compil")))
    return "DOMAIN FACT: Research agents read web sources, documents, or databases (inputs) and produce synthesized reports or summaries (outputs). Input sources and output reports are different things.";

  // Content / marketing
  if (l.includes("content") && (l.includes("generat") || l.includes("creat") || l.includes("draft") || l.includes("write")))
    return "DOMAIN FACT: Content generation agents read briefs, brand guidelines, and reference material (inputs) and produce written content like articles, posts, or copy (outputs).";
  if (l.includes("seo") || l.includes("keyword"))
    return "DOMAIN FACT: SEO agents read existing content or target topics (inputs) and produce keyword analyses, optimized content, or recommendations (outputs).";

  // Procurement / purchasing
  if (l.includes("material request") || l.includes("purchase order") || l.includes("po ") || l.includes(" po"))
    return "DOMAIN FACT: A material request or purchase order agent reads a vendor quote (input) and produces a filled-out company PO or MR form (output). The quote is the input. The completed form is the output. These are different things.";

  return "";
};

const STEPS = [
  {
    key: "concept",
    headline: "What should your agent do?",
    sub: "Describe it like you'd explain it to a colleague. Plain English is perfect.",
    placeholder: "e.g. An agent that reads construction spec documents and builds a formatted submittal log — and updates it whenever a bulletin changes the specs",
    hint: "Include: what triggers it, what it produces, and any ongoing update scenarios.",
    coachQ: (val, concept, ctx, correction) => {
      const domainCtx = getDomainContext(val + " " + (concept||""));
      const correctionCtx = correction ? "IMPORTANT: The user has clarified that at their company, this process means: \"" + correction + "\". Use this understanding for all recommendations.\n\n" : "";
      return (domainCtx ? domainCtx + "\n\n" : "") +
        correctionCtx +
        "Agent description: \"" + val + "\"\n\n" +
        "Return a JSON object with exactly these two keys:\n" +
        "1. \"understanding\": One sentence describing what you assume this agent\'s process means at the user\'s company (be specific about business context, not just technical)\n" +
        "2. \"hints\": Array of 2-3 gaps, each with gap description and 3 injectable options\n\n" +
        "Return ONLY this JSON with no other text:\n" +
        "{\"understanding\":\"I\'m treating [term] as [specific business process assumption]...\",\"hints\":[{\"gap\":\"...\",\"options\":[\"...\",\"...\",\"...\"]}]}";
    },
  },
  {
    key: "trigger",
    headline: "What kicks it off?",
    sub: "What starts the agent running? There can be more than one.",
    placeholder: "e.g. New project starts (primary). Also when a bulletin is received...",
    hint: "Think about: the initial trigger, ongoing update triggers, and manual override.",
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nCurrent trigger description: \"" + val + "\"\n\nBased on what has been defined, identify missing trigger scenarios. Simplest first (manual, file upload, email, schedule) before platform APIs. Options must be specific to THIS agent.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "inputs",
    headline: "What does it read or receive?",
    sub: "What information does it need to do its job?",
    placeholder: "e.g. The spec PDFs, project name, GC name, any bulletins issued...",
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nInputs described: \"" + val + "\"\n\nBased on the full context above, what inputs are missing? Options must match this specific agent. For each gap provide 3 short injectable options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "outputs",
    headline: "What does it produce?",
    sub: "When it finishes, what exists that did not exist before?",
    placeholder: "e.g. A formatted Excel submittal log with spec section, type, status columns...",
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nOutputs described: \"" + val + "\"\n\nBased on the full context, what output details are missing? For each gap provide 3 short options specific to this agent.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "template",
    headline: "Confirm your output template.",
    sub: "Verify the template the agent will use to format its output.",
    placeholder: "e.g. Our standard Murray Company submittal log Excel template with columns for item number, spec section, description, type, and status...",
    hint: "Upload the actual file — not a description of it. The agent will learn your exact column structure, field names, and format.",
    optional: true,
    isTemplate: true,
    coachQ: (val, concept) => "Agent: \"" + concept + "\"\nOutput template described: \"" + val + "\"\n\nWhat template details are missing that would help the agent format its output correctly? For each gap, provide 3 short options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"Template column structure is unclear...\",\"options\":[\"with columns for item number, spec section, description, type, and status\",\"following our standard company Excel format\",\"matching the GC\'s required submittal log format\"]}]",
  },
  {
    key: "crossReference",
    headline: "What other documents does it need to cross-reference?",
    sub: "Are there secondary documents it should compare against to catch conflicts or inconsistencies?",
    placeholder: "e.g. Drawing schedules and equipment schedules — so if Division 22 specifies American Standard but the plumbing fixture schedule shows Toto, it flags the conflict...",
    hint: "This is how your agent catches spec vs. drawing conflicts, substitution issues, or version mismatches.",
    optional: true,
    starterHints: [
      { gap: "Does it need to verify anything before producing its output?", options: ["no — just process the input and produce the output, no cross-checks needed for v1", "compare against a reference list I upload to flag anything not on the approved list", "compare against a previous version of the output to catch changes or conflicts"] },
      { gap: "Are there secondary documents it should check against?", options: ["no secondary documents needed for v1 — keep it simple", "a lookup table or reference list I upload once and it checks against every run", "a prior output or log file to detect duplicates or conflicts"] },
    ],
    coachQ: (val, concept) => "Agent: \"" + concept + "\"\nCross-reference docs: \"" + val + "\"\n\nWhat cross-reference sources are missing? Think about document conflicts, version mismatches, substitution tracking. For each gap, provide 3 short options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"No conflict detection source specified...\",\"options\":[\"cross-referencing drawing fixture schedules against spec sections\",\"cross-referencing the approved products list against what\'s specified\",\"cross-referencing previous submittal log versions to track changes\"]}]",
  },
  {
    key: "knowledge",
    headline: "What does it need to look up or reference?",
    sub: "Structured data it queries, past examples it follows, or rules it applies consistently.",
    placeholder: "e.g. Approved products list (as a lookup table), past submittal log examples formatted for reference, Division naming conventions...",
    hint: "Think structured data and formatted examples — not prose docs. Rules and behavioral logic get encoded into the agent directly, not uploaded here.",
    optional: true,
    starterHints: [
      { gap: "Structured lookup data it queries", options: ["an approved products/manufacturers list as a structured table", "a pricing or cost reference table it queries by item", "a lookup table of standard item descriptions and spec sections"] },
      { gap: "Formatted examples it follows", options: ["2-3 past completed outputs formatted as structured examples", "sample entries showing correct format and field values", "a reference set of correctly classified items with explanations"] },
    ],
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nReference data described: \"" + val + "\"\n\nIMPORTANT: Distinguish between (1) structured lookup data the agent queries (approved lists, pricing tables, product substitutions) and (2) formatted few-shot examples it follows. Do NOT suggest prose documents, lessons learned, or behavioral rules — those get encoded differently. For each gap provide 3 short specific options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "systems",
    headline: "What other apps does it connect to?",
    sub: "Which existing software does it read from or write to?",
    placeholder: "e.g. Box (spec storage), Excel (output log), Procore (tracking sync)...",
    hint: "Be specific. 'Box' is more useful than 'cloud storage'.",
    optional: true,
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nSystems described: \"" + val + "\"\n\nBased on the inputs, outputs, and triggers already defined, what systems are missing? Prefer simple integrations. For each gap provide 3 short options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "humanGate",
    headline: "When should it stop and check with you?",
    sub: "What decisions are too important to make on its own?",
    placeholder: "e.g. Before delivering to external parties, when it finds a spec conflict...",
    hint: "Good agents know their limits.",
    starterHints: [
      { gap: "Before the output is delivered or sent", options: ["always show me the completed output for review before saving or sending", "only flag for review if a required field couldn't be filled", "produce the output automatically — I'll review it myself afterwards"] },
      { gap: "When something is missing or unclear in the input", options: ["stop and ask me what value to use for any missing required field", "leave the field blank and flag it with a note", "make a best guess and mark it clearly for my review"] },
      { gap: "For any values I always need to confirm", options: ["ask me to confirm key reference values (like codes, numbers, or IDs) before starting", "use whatever values I provide at the start with no confirmation needed", "pre-fill from the last run and let me change anything before it proceeds"] },
    ],
    coachQ: (val, concept, ctx) => "What has been defined so far:\n" + (ctx||concept) + "\n\nHuman oversight described: \"" + val + "\"\n\nBased on everything defined — especially the outputs and systems — what oversight gates are missing? When should this specific agent stop and check before proceeding? For each gap provide 3 short injectable options.\n\nReturn ONLY JSON array:\n[{\"gap\":\"gap description\",\"options\":[\"option A\",\"option B\",\"option C\"]}]",
  },
  {
    key: "name",
    headline: "Give it a name.",
    sub: "What do you want to call this agent?",
    placeholder: "e.g. Submittal Scout, Spec Parser, RFI Tracker...",
    hint: "Names make agents feel real.",
    noSuggest: true,
    noCoach: true,
  },
];

function HintCard({ hint, index, addedOption, onInject, onDiscuss }) {
  // hint = { gap: string, options: string[] }
  const isAdded = !!addedOption;
  return (
    <div style={{
      background: isAdded ? C.success + "0D" : "#0D1B27",
      border: "1px solid " + (isAdded ? C.success + "40" : "#1D3246"),
      borderRadius: "8px", padding: "0.7rem 0.8rem", marginBottom: "0.4rem",
    }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <span style={{ color: isAdded ? C.success : C.accent, flexShrink: 0, fontSize: "0.65rem", marginTop: "3px" }}>
          {isAdded ? "+" : "->"}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.82rem", color: isAdded ? C.muted : "#D0E4EE", lineHeight: 1.65, marginBottom: "0.55rem" }}>
            {hint.gap}
          </div>
          {isAdded ? (
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.success }}>
              Added: "{addedOption}"
            </div>
          ) : (
            <div>
              {hint.options && hint.options.length > 0 && (
                <div style={{ marginBottom: "0.45rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.cyan, marginBottom: "0.3rem", letterSpacing: "0.06em" }}>
                    PICK A SOLUTION TO INJECT:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {hint.options.map((opt, oi) => (
                      <button
                        key={oi}
                        onClick={() => onInject(index, opt)}
                        style={{
                          background: "#0A1E2E", border: "1px solid " + C.cyan + "44",
                          borderRadius: "6px", padding: "0.4rem 0.65rem",
                          color: "#A0D4E8", fontFamily: "monospace", fontSize: "0.62rem",
                          cursor: "pointer", textAlign: "left", lineHeight: 1.5,
                          transition: "background 0.15s",
                        }}
                        onMouseOver={e => e.currentTarget.style.background = "#0F2A3E"}
                        onMouseOut={e => e.currentTarget.style.background = "#0A1E2E"}
                      >
                        + {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={() => onDiscuss(hint.gap)}
                style={{
                  background: "transparent", border: "1px solid #1D3246", borderRadius: "5px",
                  padding: "0.3rem 0.65rem", color: "#7090A8",
                  fontFamily: "monospace", fontSize: "0.55rem", cursor: "pointer",
                }}
              >
                Discuss instead
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBox({ open, onToggle, history, onSend, loading, concept, stepHeadline }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" }); }, [history]);

  if (!open) {
    return (
      <button
        onClick={onToggle}
        style={{
          width: "100%", background: "transparent", border: "1px solid " + C.border,
          borderRadius: "8px", padding: "0.55rem 0.85rem", color: C.muted,
          fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "0.5rem", textAlign: "left",
        }}
      >
        <span>Chat</span>
        <span>Not sure what this means? Ask me anything.</span>
      </button>
    );
  }

  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: C.dim, padding: "0.4rem 0.7rem", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>Assistant (knows your agent)</span>
        <button onClick={onToggle} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>x</button>
      </div>
      <div style={{ maxHeight: "170px", overflowY: "auto", padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {history.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              background: m.role === "user" ? C.accent : C.dim,
              color: m.role === "user" ? "#000" : C.text,
              borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
              padding: "0.45rem 0.6rem", fontFamily: "monospace", fontSize: "0.63rem",
              lineHeight: 1.6, maxWidth: "88%",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex" }}>
            <div style={{ background: C.dim, borderRadius: "10px 10px 10px 2px", padding: "0.45rem 0.6rem", fontFamily: "monospace", fontSize: "0.6rem", color: C.muted }}>
              Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "0.4rem 0.5rem", borderTop: "1px solid " + C.border, display: "flex", gap: "0.3rem" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && input.trim()) { onSend(input.trim()); setInput(""); } }}
          placeholder="Ask anything..."
          style={{ flex: 1, background: C.bg, border: "1px solid " + C.dim, borderRadius: "6px", padding: "0.38rem 0.5rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", outline: "none" }}
        />
        <button
          onClick={() => { if (input.trim()) { onSend(input.trim()); setInput(""); } }}
          disabled={!input.trim() || loading}
          style={{ background: input.trim() ? C.accent : C.dim, border: "none", borderRadius: "6px", padding: "0.38rem 0.65rem", color: input.trim() ? "#000" : C.muted, fontFamily: "monospace", fontWeight: 700, cursor: input.trim() ? "pointer" : "not-allowed" }}
        >
          -&gt;
        </button>
      </div>
    </div>
  );
}

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
  const [ragDocuments, setRagDocuments] = useState([]); // {name, file, category, analysis}
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
        const ctx = buildContext(data);
        const correction = correctionRef.current || "";
        const q = cur.coachQ(val, data.concept || "", ctx, correction);
        const raw = await callClaude([{ role: "user", content: q }], "", 500);
        const parsed = parseJSON(raw);

        // Handle new format: { understanding, hints } or old format: array
        if (parsed && !Array.isArray(parsed) && parsed.hints) {
          if (parsed.understanding) setAiUnderstanding(parsed.understanding);
          const arr = parsed.hints;
          if (Array.isArray(arr) && arr.length > 0) {
            const normalized = arr.slice(0, 3).map(item =>
              typeof item === "string"
                ? { gap: item, options: [] }
                : { gap: item.gap || "", options: Array.isArray(item.options) ? item.options : [] }
            );
            setHints(normalized.filter(h => h.gap));
          }
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          // Fallback: old array format
          const normalized = parsed.slice(0, 3).map(item =>
            typeof item === "string"
              ? { gap: item, options: [] }
              : { gap: item.gap || "", options: Array.isArray(item.options) ? item.options : [] }
          );
          setHints(normalized.filter(h => h.gap));
        } else {
          setHints(getFallbackHints(cur.key, data.concept));
        }
      } catch (e) {
        setHints(getFallbackHints(cur.key, data.concept));
      }
      setHintsLoading(false);
    }, 1300);
    return () => clearTimeout(coachTimer.current);
  }, [val, cur.key]);

  useEffect(() => {
    setHints([]); setHintsLoading(false); setAddedOptions({}); setChatOpen(false); setChatHistory([]); setChatSolution(""); setAiUnderstanding(""); setCorrectingUnderstanding(false); setCorrectionInput(""); if (!cur.isTemplate) setTemplateFile(null);

    // Generate context-aware starter hints for steps that benefit from them
    const stepsNeedingContext = ["template", "crossReference", "knowledge", "humanGate", "systems"];
    if (stepsNeedingContext.includes(cur.key) && !contextHints[cur.key] && data.concept) {
      generateContextHints(cur.key);
    }
  }, [step]);

  const generateContextHints = async (stepKey) => {
    setContextHintsLoading(true);
    const contextSoFar = [
      data.concept && "Concept: " + data.concept,
      data.trigger && "Trigger: " + data.trigger,
      data.inputs && "Inputs: " + data.inputs,
      data.outputs && "Outputs: " + data.outputs,
      data.template && "Output template: " + data.template,
      data.crossReference && "Cross-references: " + data.crossReference,
    ].filter(Boolean).join("\n");

    const questionMap = {
      template: "What output template or format should this agent follow? Should it match a company template, a specific column structure, or a standard format?",
      crossReference: "What secondary documents should this agent compare against to catch conflicts, inconsistencies, or mismatches? Think about what could go wrong if two documents disagree.",
      knowledge: "What historical records, past examples, or institutional knowledge should this agent reference to improve its accuracy and consistency?",
      systems: "What specific apps, platforms, or tools does this agent need to connect to — for reading input, storing output, or notifying people?",
      humanGate: "When should this agent stop and wait for human approval before proceeding? Think about irreversible actions, external communications, and situations where it might be wrong.",
    };

    const domainCtx = getDomainContext(data.concept || "");

    try {
      const raw = await callClaude([{
        role: "user",
        content: "Here is everything we know about an AI agent being designed:\n\n" + contextSoFar +
          "\n\n" + (domainCtx ? domainCtx + "\n\n" : "") +
          "Based on this specific agent, answer this question by providing 3 concrete options the user can choose from:\n" +
          questionMap[stepKey] +
          "\n\nProvide options that are SPECIFIC to this agent — not generic. Each option should be a short phrase the user can inject into their description.\n\n" +
          "Return ONLY a JSON array of 3 objects:\n" +
          "[{\"gap\":\"short description of this option category\",\"options\":[\"specific option A\",\"specific option B\",\"specific option C\"]}," +
          "{\"gap\":\"another category\",\"options\":[\"option A\",\"option B\",\"option C\"]}]"
      }], "", 400);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setContextHints(p => ({ ...p, [stepKey]: parsed }));
      }
    } catch (e) { /* silent — fallback to static starterHints */ }
    setContextHintsLoading(false);
  };

  const generateSuggestions = async (concept) => {
    setSuggestState("loading");
    try {
      const raw = await callClaude([{
        role: "user",
        content: "Agent concept: \"" + concept + "\"\n\nGenerate specific suggestions for each field. Think about the agent lifecycle. Always suggest the simplest viable approach first. Return ONLY raw JSON with no markdown:\n{\"trigger\":\"...\",\"inputs\":\"...\",\"outputs\":\"...\",\"knowledge\":\"...\",\"systems\":\"...\",\"humanGate\":\"when to stop and check with a human before taking action\"}"
      }], "", 500);
      const parsed = parseJSON(raw);
      if (parsed && parsed.trigger) {
        setSuggestions(parsed);
      } else {
        const fb = {};
        ["trigger", "inputs", "outputs", "template", "crossReference", "knowledge", "systems"].forEach(k => { fb[k] = getFallback(concept, k); });
        setSuggestions(fb);
      }
    } catch (e) {
      const fb = {};
      ["trigger", "inputs", "outputs", "knowledge", "systems"].forEach(k => { fb[k] = getFallback(data.concept || "", k); });
      setSuggestions(fb);
    }
    setSuggestState("done");
  };

  const buildBlueprint = (d) => {
    const lines = [
      "# AGENT BLUEPRINT: " + (d.name || "My Agent"),
      "# Agent Academy | Generated " + new Date().toLocaleDateString(),
      "",
      "## CONCEPT",
      d.concept || "",
      "",
      "## TRIGGER CONDITIONS",
      d.trigger || "(not defined)",
      "",
      "## INPUTS",
      d.inputs || "(not defined)",
      "",
      "## OUTPUTS",
      d.outputs || "(not defined)",
      "",
      "## OUTPUT TEMPLATE",
      d.template || "(none specified)",
      "",
      "## CROSS-REFERENCE DOCUMENTS",
      d.crossReference || "(none specified)",
      "",
      "## RAG DOCUMENT LIBRARY",
      d.ragDocuments && d.ragDocuments.length > 0
        ? d.ragDocuments.map(doc => "- " + doc.name + " [" + doc.category + "]").join("\n")
        : "(none uploaded)",
      d.templateAnalysis && d.templateAnalysis.fields
        ? "\nTEMPLATE FIELDS: " + d.templateAnalysis.fields.join(", ")
        : "",
      "",
      "## HISTORICAL KNOWLEDGE",
      d.knowledge || "(none specified)",
      "",
      "## EXTERNAL SYSTEMS",
      d.systems || "(none specified)",
      "",
      "## HUMAN OVERSIGHT GATES",
      d.humanGate || "(not defined)",
      "",
      "---",
      "DEPLOY WITH CLAUDE CODE:",
      "Build a production-ready agent based on this blueprint.",
      "Use Python with the Anthropic SDK. State in Supabase.",
      "Start with the core loop and failure handling, then add tools.",
      "Follow all architectural decisions exactly as specified.",
    ];
    return lines.join("\n");
  };

  const goNext = () => {
    if (!canProceed) return;
    const newData = { ...data, [cur.key]: val };
    setData(newData);
    if (cur.key === "concept" && val.trim()) generateSuggestions(val.trim());
    if (isLast) {
      const agentOut = { agentName: newData.name || "My Agent", concept: newData.concept, triggers: newData.trigger, inputs: newData.inputs, outputs: newData.outputs, template: newData.template, templateCategory: templateCategory, templateFile: earlyTemplateFile, templateAnalysis: templateAnalysis, crossReference: newData.crossReference, ragDocuments: ragDocuments, rag: newData.knowledge, systems: newData.systems, constraints: newData.humanGate };
      setBlueprint(buildBlueprint(newData));
      if (typeof onComplete === "function") onComplete(agentOut);
    } else {
      setStep(s => s + 1);
    }
  };

  const goBack = () => setStep(s => s - 1);
  const skipStep = () => setStep(s => s + 1);

  const handleInject = (index, option) => {
    skipNextCoach.current = true;
    setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + ", " + option }));
    setAddedOptions(p => ({ ...p, [index]: option }));
  };

  const handleDiscussHint = (hint) => {
    setChatOpen(true);
    setChatHistory([{ role: "assistant", content: "Let's talk about this gap: \"" + hint.substring(0, 90) + "\". How does this apply to your agent specifically? I can help you figure out the right answer." }]);
  };

  const handleChatSend = async (msg) => {
    setChatLoading(true);
    const hist = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(hist);
    try {
      const ctx = buildContext(data);
      const sys = "You help people design AI agents in plain English.\n\nEverything defined so far:\n" + ctx + "\n\nCurrent step: \"" + cur.headline + "\" — " + cur.sub + "\n\nCRITICAL RULES:\n1. Stay ONLY on the current step. Do NOT ask about or mention future steps.\n2. When you reach a conclusion or solution together, end your response with: SOLUTION: [one concise sentence summarizing what was decided] so the user can inject it.\n3. Keep responses under 80 words.\n4. No jargon. Concrete examples from their specific agent only.";
      const r = await callClaude(hist, sys, 250);
      // Extract solution if present
      const solutionMatch = r.match(/SOLUTION:\s*(.+?)(?:\n|$)/i);
      if (solutionMatch) {
        setChatSolution(solutionMatch[1].trim());
        const cleanResponse = r.replace(/SOLUTION:\s*.+?(?:\n|$)/i, "").trim();
        setChatHistory([...hist, { role: "assistant", content: cleanResponse }]);
      } else {
        setChatSolution("");
        setChatHistory([...hist, { role: "assistant", content: r }]);
      }
    } catch (e) {
      setChatHistory([...hist, { role: "assistant", content: "Connection issue, try again." }]);
    }
    setChatLoading(false);
  };

  const pct = Math.round((step / (STEPS.length - 1)) * 100);

  // Blueprint completion screen
  if (blueprint) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", padding: "1.5rem" }}>
        <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "700px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "1.1rem 1.5rem 0.85rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.success, letterSpacing: "0.1em", marginBottom: "0.15rem" }}>+ BLUEPRINT COMPLETE</div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.text }}>
                {data.name || "Your Agent"} is ready to build.
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => { navigator.clipboard.writeText(blueprint); setBpCopied(true); setTimeout(() => setBpCopied(false), 2500); }}
                style={{ background: bpCopied ? C.success : "linear-gradient(135deg," + C.accent + "," + C.gold + ")", border: "none", borderRadius: "7px", padding: "0.5rem 0.9rem", color: bpCopied ? "#fff" : "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}
              >
                {bpCopied ? "+ COPIED" : "COPY FOR CLAUDE CODE"}
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.5rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, marginBottom: "0.5rem", letterSpacing: "0.07em" }}>YOUR AGENT BLUEPRINT — paste this into Claude Code to build</div>
            <pre style={{ background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", padding: "1rem", fontFamily: "monospace", fontSize: "0.68rem", color: "#B0D4E0", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: 0, marginBottom: "1rem" }}>
              {blueprint}
            </pre>
            <div style={{ background: C.dim, border: "1px solid " + C.gold + "33", borderRadius: "8px", padding: "0.85rem 1rem", marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.gold, marginBottom: "0.4rem", letterSpacing: "0.07em" }}>NEXT STEPS</div>
              {[
                "Copy the blueprint above and open Claude Code",
                "Paste: Build a production agent from this blueprint",
                "Claude Code builds your agent with state, tools, and failure handling",
                "Come back to the Academy to refine and improve it over time"
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem", flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.63rem", color: "#A0B8C8", lineHeight: 1.55 }}>{s}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setBlueprint(null); setStep(0); setData({}); setSuggestions({}); setSuggestState("idle"); }}
              style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.55rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", width: "100%" }}
            >
              Start over with a different agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.94)", zIndex: 1000, fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        input, textarea { outline: none; }
        @keyframes fadeup { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .fadein { animation: fadeup 0.2s ease; }
        .intake-outer { display:flex; justify-content:center; align-items:flex-end; width:100%; }
        .intake-modal {
          background: #0B0F16;
          border: 1px solid #182430;
          width: 100%;
          max-width: 540px;
          border-radius: 16px 16px 0 0;
          border-bottom: none;
          max-height: 94vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        @media (min-width: 700px) {
          .intake-outer { align-items: center; padding: 2rem; }
          .intake-modal {
            border-radius: 14px;
            border-bottom: 1px solid #182430;
            max-width: 660px;
            max-height: 88vh;
          }
        }
        @media (min-width: 1100px) {
          .intake-modal { max-width: 760px; }
          .intake-inner { padding: 1.5rem 2rem 0.75rem !important; }
          .intake-head { padding: 1rem 2rem 0.7rem !important; }
          .intake-foot { padding: 0.8rem 2rem 1.1rem !important; }
        }
      `}</style>

      <div className="intake-outer">
        <div className="intake-modal">

          <div className="intake-head" style={{ padding: "0.9rem 1.25rem 0.65rem", borderBottom: "1px solid #182430", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.45rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.accent, letterSpacing: "0.1em" }}>AGENT ACADEMY - {step + 1}/{STEPS.length}</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>{pct}%</span>
            </div>
            <div style={{ height: "3px", background: C.dim, borderRadius: "2px", overflow: "hidden", marginBottom: "0.35rem" }}>
              <div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg," + C.accent + "," + C.gold + ")", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              {STEPS.map((_, i) => (
                <div key={i} style={{ flex: 1, height: "2px", borderRadius: "1px", background: i < step ? C.accent : i === step ? C.gold : C.dim, transition: "background 0.3s" }} />
              ))}
            </div>
          </div>

          <div className="intake-inner fadein" style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.25rem 0.5rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.4rem", margin: "0 0 0.2rem", color: C.text, lineHeight: 1.15 }}>{cur.headline}</h2>
            <p style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.muted, margin: "0 0 0.85rem", lineHeight: 1.6 }}>
              {cur.sub}{cur.optional ? <span style={{ color: C.accent }}> - optional</span> : null}
            </p>

            {suggestState === "loading" && !cur.noSuggest && step > 0 && (
              <div style={{ background: C.dim, border: "1px solid " + C.gold + "22", borderRadius: "10px", padding: "0.65rem 0.85rem", marginBottom: "0.7rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ color: C.gold, display: "inline-block" }}>o</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.57rem", color: C.gold }}>Building a suggestion for your agent...</span>
              </div>
            )}

            {suggestState === "done" && hasSuggestion && !val && (
              <div className="fadein" style={{ background: "#0E1A26", border: "1px solid " + C.gold + "66", borderRadius: "10px", overflow: "hidden", marginBottom: "0.7rem" }}>
                <div style={{ background: C.gold + "18", padding: "0.45rem 0.85rem", borderBottom: "1px solid " + C.gold + "33", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>SUGGESTED FOR YOUR AGENT</span>
                </div>
                <div style={{ padding: "0.75rem 0.85rem 0.65rem" }}>
                  <div style={{ fontSize: "0.83rem", color: C.text, lineHeight: 1.7, marginBottom: "0.7rem" }}>{suggestions[cur.key]}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem" }}>
                    <button onClick={() => setData(p => ({ ...p, [cur.key]: suggestions[cur.key] }))}
                      style={{ background: "linear-gradient(135deg," + C.gold + ",#D97706)", border: "none", borderRadius: "7px", padding: "0.5rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer", gridColumn: "1 / -1" }}>
                      Use This
                    </button>
                    <button onClick={() => { setChatOpen(true); setChatHistory([{ role: "assistant", content: "Happy to revise that suggestion. What would you like to change about it?" }]); }}
                      style={{ background: "transparent", border: "1px solid " + C.gold + "55", borderRadius: "7px", padding: "0.45rem", color: C.gold, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>
                      Revise
                    </button>
                    <button onClick={() => { setChatOpen(true); setChatHistory([{ role: "assistant", content: "Let's discuss this suggestion. What questions do you have about it, or what doesn't feel right?" }]); }}
                      style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "7px", padding: "0.45rem", color: C.muted, fontFamily: "monospace", fontSize: "0.58rem", cursor: "pointer" }}>
                      Discuss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {val && val === suggestions[cur.key] && hasSuggestion && (
              <div style={{ marginBottom: "0.45rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ color: C.success, fontSize: "0.58rem" }}>+</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted }}>Suggestion applied - edit freely below</span>
              </div>
            )}

            {/* Template already uploaded notice */}
            {cur.key === "template" && earlyTemplateFile && (
              <div className="fadein" style={{ marginBottom: "0.65rem", background: "#0A1A10", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.85rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>TEMPLATE ALREADY UPLOADED FROM STEP 1</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <span style={{ color: C.success }}>+</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text }}>{earlyTemplateFile.name}</span>
                </div>
                {templateAnalysis && (
                  <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#80A890", lineHeight: 1.6 }}>
                    {templateAnalysis.summary}
                    {templateAnalysis.fields && (
                      <div style={{ marginTop: "0.3rem", display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                        {templateAnalysis.fields.slice(0, 10).map((f, i) => (
                          <span key={i} style={{ background: C.success + "22", border: "1px solid " + C.success + "33", borderRadius: "3px", padding: "0.1rem 0.35rem", fontSize: "0.48rem", color: C.success }}>{f}</span>
                        ))}
                        {templateAnalysis.fields.length > 10 && <span style={{ fontSize: "0.48rem", color: C.muted }}>+{templateAnalysis.fields.length - 10} more</span>}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.4rem" }}>
                  This template is in your agent's document library. You can add a description below or skip this step.
                </div>
              </div>
            )}

            <textarea
              value={val}
              onChange={e => setData(p => ({ ...p, [cur.key]: e.target.value }))}
              placeholder={cur.placeholder}
              rows={4}
              style={{ width: "100%", background: C.card, border: "1px solid " + (val ? C.accent + "55" : C.border), borderRadius: "10px", padding: "0.8rem", color: C.text, fontFamily: "monospace", fontSize: "0.78rem", lineHeight: 1.7, resize: "none", transition: "border 0.2s", display: "block" }}
            />

            {cur.hint && (
              <div style={{ fontFamily: "monospace", fontSize: "0.56rem", color: C.muted, marginTop: "0.4rem", lineHeight: 1.5 }}>
                {cur.hint}
              </div>
            )}

            {cur.isTemplate && (
              <div style={{ marginTop: "0.75rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.4rem" }}>
                  UPLOAD YOUR TEMPLATE FILE (optional)
                </div>
                {/* Category selector */}
                <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                  {[
                    { key: "template", label: "Output template" },
                    { key: "reference_data", label: "Lookup / reference data" },
                    { key: "crossref", label: "Cross-reference doc" },
                    { key: "few_shot", label: "Example outputs" },
                  ].map(cat => (
                    <button key={cat.key} onClick={() => setTemplateCategory(cat.key)}
                      style={{ background: templateCategory === cat.key ? C.gold + "22" : "transparent", border: "1px solid " + (templateCategory === cat.key ? C.gold : C.border), borderRadius: "5px", padding: "0.25rem 0.55rem", color: templateCategory === cat.key ? C.gold : C.muted, fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer" }}>
                      {cat.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted, marginBottom: "0.4rem", lineHeight: 1.5 }}>
                  {{
                    template: "The agent will populate this exact format for its output.",
                    reference_data: "A structured table the agent queries at run-time (approved products, pricing, substitutions). CSV or JSON preferred.",
                    crossref: "A document the agent compares against the main input to catch conflicts.",
                    few_shot: "Formatted past examples the agent uses as reference for how to structure its output.",
                  }[templateCategory]}
                </div>
                {templateFile ? (
                  <div style={{ background: C.success + "0D", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ color: C.success }}>+</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text }}>{templateFile.name}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>{templateCategory}</span>
                    </div>
                    <button onClick={() => setTemplateFile(null)}
                      style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => templateFileRef.current && templateFileRef.current.click()}
                    style={{ background: C.code, border: "1px dashed " + C.gold + "44", borderRadius: "8px", padding: "0.7rem 0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.6rem" }}
                  >
                    <span style={{ color: C.gold, fontSize: "0.85rem" }}>+</span>
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted }}>Drop your Excel, PDF, or CSV template here</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.dim, marginTop: "0.1rem" }}>The agent will learn your exact column structure and format</div>
                    </div>
                  </div>
                )}
                <input ref={templateFileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }}
                  onChange={e => e.target.files[0] && setTemplateFile(e.target.files[0])} />
              </div>
            )}
            {/* Template question — surfaces when concept describes a document output */}
            {cur.key === "concept" && val.trim().length > 20 && outputIsDocument(val) && !val.toLowerCase().includes("template i can upload") && !val.toLowerCase().includes("design the format") && !val.toLowerCase().includes("create one together") && (
              <div className="fadein" style={{ marginTop: "0.75rem", background: "#0E1A26", border: "1px solid " + C.gold + "55", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ background: C.gold + "18", padding: "0.5rem 0.85rem", borderBottom: "1px solid " + C.gold + "33" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.gold, fontWeight: 700, letterSpacing: "0.07em" }}>YOUR AGENT PRODUCES A DOCUMENT</span>
                </div>
                <div style={{ padding: "0.75rem 0.85rem" }}>
                  <div style={{ fontSize: "0.84rem", color: C.text, lineHeight: 1.65, marginBottom: "0.65rem" }}>
                    Does your company already have a template or format for this output?
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    {[
                      "yes — I have an existing template I can upload",
                      "no — help me design the format and fields",
                      "not yet — let's create one together as we go",
                    ].map((opt, oi) => (
                      <button key={oi}
                        onClick={() => { skipNextCoach.current = true; setData(p => ({ ...p, concept: (p.concept || "").trimEnd() + ", " + opt })); }}
                        style={{ background: "#0A1E2E", border: "1px solid " + C.gold + "33", borderRadius: "6px", padding: "0.45rem 0.7rem", color: "#A8C4D8", fontFamily: "monospace", fontSize: "0.63rem", cursor: "pointer", textAlign: "left", transition: "background 0.15s" }}
                        onMouseOver={e => e.currentTarget.style.background = "#0F2A3E"}
                        onMouseOut={e => e.currentTarget.style.background = "#0A1E2E"}
                      >
                        + {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Early template upload — appears immediately after user says they have a template */}
            {cur.key === "concept" && val.toLowerCase().includes("template i can upload") && (
              <div className="fadein" style={{ marginTop: "0.75rem", background: "#0A1A10", border: "1px solid " + C.success + "55", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ background: C.success + "18", padding: "0.5rem 0.85rem", borderBottom: "1px solid " + C.success + "33", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ color: C.success, fontSize: "0.7rem" }}>+</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.success, fontWeight: 700, letterSpacing: "0.07em" }}>UPLOAD YOUR TEMPLATE NOW</span>
                </div>
                <div style={{ padding: "0.75rem 0.85rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: "#90B8A0", lineHeight: 1.6, marginBottom: "0.65rem" }}>
                    Upload it here and the agent will read your actual fields — so every subsequent step gets pre-filled based on what your template actually requires. You won't have to guess.
                  </div>
                  {earlyTemplateFile ? (
                    <div>
                      <div style={{ background: C.success + "0D", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ color: C.success }}>+</span>
                          <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: C.text }}>{earlyTemplateFile.name}</span>
                        </div>
                        <button onClick={() => { setEarlyTemplateFile(null); setTemplateAnalysis(null); }}
                          style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontFamily: "monospace", fontSize: "0.6rem" }}>
                          Remove
                        </button>
                      </div>
                      {analyzingTemplate && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0" }}>
                          <span style={{ color: C.success, fontFamily: "monospace", fontSize: "0.6rem" }}>o</span>
                          <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.success }}>Reading your template and mapping required fields...</span>
                        </div>
                      )}
                      {templateAnalysis && !analyzingTemplate && (
                        <div style={{ background: C.code, border: "1px solid " + C.success + "33", borderRadius: "6px", padding: "0.55rem 0.7rem" }}>
                          <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>FIELDS DETECTED — steps 3-9 pre-filled from your template</div>
                          <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#80A890", lineHeight: 1.6 }}>
                            {templateAnalysis.summary}
                          </div>
                          {templateAnalysis.fields && templateAnalysis.fields.length > 0 && (
                            <div style={{ marginTop: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                              {templateAnalysis.fields.slice(0, 12).map((f, i) => (
                                <span key={i} style={{ background: C.success + "22", border: "1px solid " + C.success + "33", borderRadius: "4px", padding: "0.1rem 0.4rem", fontFamily: "monospace", fontSize: "0.5rem", color: C.success }}>{f}</span>
                              ))}
                              {templateAnalysis.fields.length > 12 && (
                                <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.muted }}>+{templateAnalysis.fields.length - 12} more</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      onClick={() => earlyTemplateRef.current && earlyTemplateRef.current.click()}
                      style={{ background: C.code, border: "1px dashed " + C.success + "44", borderRadius: "8px", padding: "0.75rem 0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.6rem" }}
                    >
                      <span style={{ color: C.success, fontSize: "0.9rem" }}>+</span>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "#70A880" }}>Drop your template file here — Excel, PDF, Word, or CSV</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.1rem" }}>Agent reads the fields and pre-fills all subsequent steps</div>
                      </div>
                    </div>
                  )}
                  <input ref={earlyTemplateRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx" style={{ display: "none" }}
                    onChange={e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setEarlyTemplateFile(file);
                      setTemplateFile(file);
                      analyzeTemplate(file, setSuggestions, setTemplateAnalysis, setAnalyzingTemplate);
                    }} />
                </div>
              </div>
            )}


            {/* Context-aware starter hints — generated from everything collected so far */}
            {!val && !hasSuggestion && (contextHints[cur.key] || cur.starterHints) && (
              <div className="fadein" style={{ marginTop: "0.65rem" }}>
                {contextHintsLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0" }}>
                    <span style={{ color: C.gold, fontFamily: "monospace", fontSize: "0.6rem" }}>o</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.57rem", color: C.gold }}>Personalizing options based on your agent...</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.gold, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>
                      {contextHints[cur.key] ? "SUGGESTED FOR YOUR AGENT — click to add" : "COMMON OPTIONS — click to add"}
                    </div>
                    {(contextHints[cur.key] || cur.starterHints).map((h, i) => (
                      <HintCard
                        key={"starter-" + i}
                        hint={h}
                        index={1000 + i}
                        addedOption={addedOptions[1000 + i] || null}
                        onInject={handleInject}
                        onDiscuss={handleDiscussHint}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            {hintsLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem" }}>
                <span style={{ color: C.cyan, fontFamily: "monospace", fontSize: "0.6rem" }}>o</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.cyan }}>Reviewing your description...</span>
              </div>
            )}

            {/* AI Understanding card */}
            {!hintsLoading && aiUnderstanding && hints.length > 0 && (
              <div className="fadein" style={{ marginTop: "0.65rem", background: "#0A1520", border: "1px solid " + C.cyan + "33", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.45rem 0.75rem", background: C.cyan + "0D", borderBottom: "1px solid " + C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ color: C.cyan, fontSize: "0.6rem" }}>◈</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.07em" }}>MY UNDERSTANDING OF YOUR PROCESS</span>
                  </div>
                  {!correctingUnderstanding && (
                    <button onClick={() => setCorrectingUnderstanding(true)}
                      style={{ background: "transparent", border: "1px solid " + C.cyan + "44", borderRadius: "4px", padding: "0.15rem 0.5rem", color: C.cyan, fontFamily: "monospace", fontSize: "0.5rem", cursor: "pointer" }}>
                      Correct this
                    </button>
                  )}
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.63rem", color: "#90B0C8", lineHeight: 1.6 }}>{aiUnderstanding}</div>
                  {correctingUnderstanding && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginBottom: "0.3rem" }}>
                        Tell me what this actually means at your company:
                      </div>
                      <input
                        value={correctionInput}
                        onChange={e => setCorrectionInput(e.target.value)}
                        placeholder={"e.g. At our company, a material request means taking a vendor quote and issuing a PO..."}
                        onKeyDown={e => {
                          if (e.key === "Enter" && correctionInput.trim()) {
                            correctionRef.current = correctionInput;
                            setCorrectingUnderstanding(false);
                            setHints([]);
                            setAiUnderstanding("");
                            skipNextCoach.current = false;
                            setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " }));
                          }
                        }}
                        style={{ width: "100%", background: C.code, border: "1px solid " + C.cyan + "44", borderRadius: "5px", padding: "0.45rem 0.6rem", color: C.text, fontFamily: "monospace", fontSize: "0.63rem", outline: "none", marginBottom: "0.35rem" }}
                      />
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button
                          onClick={() => {
                            if (!correctionInput.trim()) return;
                            correctionRef.current = correctionInput;
                            setCorrectingUnderstanding(false);
                            setHints([]);
                            setAiUnderstanding("");
                            skipNextCoach.current = false;
                            // Append a space to val to trigger useEffect re-run
                            setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " }));
                          }}
                          style={{ background: C.cyan, border: "none", borderRadius: "5px", padding: "0.35rem 0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}
                        >
                          Update recommendations
                        </button>
                        <button onClick={() => { setCorrectingUnderstanding(false); setCorrectionInput(""); }}
                          style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.35rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!hintsLoading && hints.length > 0 && (
              <div className="fadein" style={{ marginTop: "0.5rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.cyan, letterSpacing: "0.07em", marginBottom: "0.45rem" }}>WHAT'S MISSING - click Add to fill in automatically</div>
                {hints.map((h, i) => (
                  <HintCard
                    key={i}
                    hint={h}
                    index={i}
                    addedOption={addedOptions[i] || null}
                    onInject={handleInject}
                    onDiscuss={handleDiscussHint}
                  />
                ))}
              </div>
            )}

            {/* RAG document upload panel — on crossReference and knowledge steps */}
            {(cur.key === "crossReference" || cur.key === "knowledge") && (
              <div style={{ marginTop: "0.75rem", background: C.dim, border: "1px solid " + C.border, borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.cyan, letterSpacing: "0.07em" }}>
                    {cur.key === "crossReference" ? "UPLOAD REFERENCE DOCUMENTS" : "UPLOAD LOOKUP DATA"}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted }}>added to agent's document library</span>
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, marginBottom: "0.5rem", lineHeight: 1.5 }}>
                    {cur.key === "crossReference"
                      ? "Upload documents the agent will compare against at run-time. These live in the agent's document library — uploaded once, available every run without the user doing anything."
                      : "Upload structured lookup tables or formatted examples (CSV preferred for lookup data). These become queryable reference data, not prose context."}
                  </div>
                  {ragDocuments.filter(d => d.step === cur.key).map((doc, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem", background: C.code, borderRadius: "6px", padding: "0.4rem 0.6rem" }}>
                      <span style={{ color: C.success, fontSize: "0.6rem" }}>+</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.text, flex: 1 }}>{doc.name}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.gold, background: C.gold + "22", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>{doc.category}</span>
                      <button onClick={() => setRagDocuments(p => p.filter((_, j) => j !== ragDocuments.indexOf(doc)))}
                        style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "0.6rem" }}>×</button>
                    </div>
                  ))}
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: C.code, border: "1px dashed " + C.cyan + "44", borderRadius: "6px", padding: "0.5rem 0.7rem", cursor: "pointer" }}>
                    <span style={{ color: C.cyan, fontSize: "0.8rem" }}>+</span>
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.muted }}>Upload a reference document or lookup table</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.dim, marginTop: "0.1rem" }}>CSV, Excel, PDF — stored in agent RAG library</div>
                    </div>
                    <input type="file" accept=".csv,.xlsx,.xls,.pdf,.doc,.docx,.json" style={{ display: "none" }}
                      onChange={e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const category = cur.key === "crossReference" ? "crossref" : "reference_data";
                        setRagDocuments(p => [...p, { name: file.name, file, category, step: cur.key }]);
                        setData(prev => ({
                          ...prev,
                          [cur.key]: (prev[cur.key] || "").trimEnd() + (prev[cur.key] ? ", " : "") + file.name + " (uploaded)"
                        }));
                      }} />
                  </label>
                </div>
              </div>
            )}

            {step > 0 && data.concept && (
              <div style={{ marginTop: "0.8rem", background: C.code, border: "1px solid " + C.dim, borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "0.4rem 0.65rem", background: C.dim, borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.muted, letterSpacing: "0.08em" }}>AGENT BLUEPRINT SO FAR</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: C.accent }}>step {step + 1} of {STEPS.length} — {cur.headline}</span>
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
                      <span style={{ fontFamily: "monospace", fontSize: "0.44rem", color: C.accent, flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "52px" }}>{item.label}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.56rem", color: "#5A8898", lineHeight: 1.55 }}>
                        {item.value.length > 90 ? item.value.substring(0, 90) + "..." : item.value}
                      </span>
                    </div>
                  ))}
                  {/* Current step indicator */}
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", borderTop: "1px solid " + C.dim, paddingTop: "0.3rem", marginTop: "0.1rem" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.44rem", color: C.gold, flexShrink: 0, marginTop: "2px", letterSpacing: "0.06em", minWidth: "52px" }}>
                      {["WHAT IT DOES","TRIGGER","READS","PRODUCES","TEMPLATE","CROSS-REF","HISTORY","SYSTEMS","OVERSIGHT","NAME"][step] || "CURRENT"}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.56rem", color: C.gold + "99", lineHeight: 1.55, fontStyle: "italic" }}>
                      {val ? (val.length > 90 ? val.substring(0, 90) + "..." : val) : cur.placeholder.substring(0, 60) + "..."}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: "0.8rem", marginBottom: "0.5rem" }}>
              <ChatBox
                open={chatOpen}
                onToggle={() => { setChatOpen(p => !p); if (!chatOpen && chatHistory.length === 0) setChatHistory([{ role: "assistant", content: "This step asks: \"" + cur.headline + "\" - " + cur.sub + " What would you like to know?" }]); }}
                history={chatHistory}
                onSend={handleChatSend}
                loading={chatLoading}
                concept={data.concept}
                stepHeadline={cur.headline}
              />
              {chatOpen && chatSolution && (
                <div style={{ marginTop: "0.4rem", background: C.success + "0F", border: "1px solid " + C.success + "44", borderRadius: "8px", padding: "0.65rem 0.75rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.success, letterSpacing: "0.07em", marginBottom: "0.3rem" }}>SOLUTION — READY TO ADD</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.text, lineHeight: 1.55, marginBottom: "0.45rem" }}>"{chatSolution}"</div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      onClick={() => {
                        skipNextCoach.current = true;
                        setData(p => ({ ...p, [cur.key]: (p[cur.key] || "").trimEnd() + " " + chatSolution }));
                        setChatSolution("");
                      }}
                      style={{ flex: 1, background: C.success, border: "none", borderRadius: "5px", padding: "0.4rem 0.75rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}
                    >
                      + Add to my description
                    </button>
                    <button
                      onClick={() => setChatSolution("")}
                      style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.4rem 0.6rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer" }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="intake-foot" style={{ padding: "0.7rem 1.25rem 0.9rem", borderTop: "1px solid " + C.border, flexShrink: 0, display: "flex", gap: "0.45rem" }}>
            {step > 0 && (
              <button onClick={goBack} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>
                Back
              </button>
            )}
            {cur.optional && (
              <button onClick={skipStep} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "8px", padding: "0.65rem 0.9rem", color: C.muted, fontFamily: "monospace", fontSize: "0.62rem", cursor: "pointer", flexShrink: 0 }}>
                Skip
              </button>
            )}
            <button
              onClick={goNext}
              disabled={!canProceed || hintsLoading}
              style={{ flex: 1, background: (canProceed && !hintsLoading) ? "linear-gradient(135deg," + C.accent + "," + C.gold + ")" : C.dim, border: "none", borderRadius: "8px", padding: "0.75rem", color: canProceed ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 800, cursor: canProceed ? "pointer" : "not-allowed", transition: "background 0.2s" }}
            >
              {isLast ? "BUILD MY BLUEPRINT" : "NEXT"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
