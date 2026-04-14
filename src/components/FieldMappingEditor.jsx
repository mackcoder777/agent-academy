/**
 * FieldMappingEditor
 *
 * Renders and edits the field map produced by analyzeTemplate().
 * Contains ZERO knowledge of any specific form.
 * Everything it displays comes from templateAnalysis — the result of
 * Claude reading the actual uploaded file via SheetJS or PDF extraction.
 *
 * Props:
 *   templateAnalysis  — result from analyzeTemplate():
 *                       { fields, required_user_inputs, auto_fillable,
 *                         computed, cell_map, summary, file_format }
 *   onUpdateMap       — (updatedCellMap) => void
 *   onClose           — () => void
 */

import { useState, useMemo } from "react";

const C = {
  bg: "#06080B", surface: "#0B0F16", card: "#0F1720", border: "#182430",
  accent: "#F97316", gold: "#F59E0B", text: "#DCE8F0", muted: "#3D5568",
  dim: "#1A2535", code: "#040608", success: "#22C55E", cyan: "#22D3EE",
  error: "#EF4444",
};

const SOURCE_META = {
  auto:     { label: "AUTO",     desc: "Extracted from source document automatically", color: "#22C55E" },
  user:     { label: "YOU",      desc: "You provide this each run — not in source docs", color: "#F59E0B" },
  computed: { label: "COMPUTED", desc: "Agent calculates this (e.g. qty × unit price)",  color: "#22D3EE" },
  skip:     { label: "SKIP",     desc: "Leave blank — not applicable",                   color: "#3D5568" },
};

function FieldRow({ entry, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draftSource, setDraftSource] = useState(entry.source || "user");
  const [draftNotes,  setDraftNotes]  = useState(entry.notes  || "");
  const [draftCell,   setDraftCell]   = useState(entry.cell   || "");

  const sm = SOURCE_META[entry.source] || SOURCE_META.skip;

  const save = () => {
    onEdit({ ...entry, source: draftSource, notes: draftNotes, cell: draftCell });
    setEditing(false);
  };

  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "8px", marginBottom: "0.4rem", overflow: "hidden" }}>
      <div style={{ padding: "0.6rem 0.85rem", display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 130px", minWidth: 0 }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.text, fontWeight: 600 }}>{entry.field}</div>
          {entry.cell && (
            <div style={{ fontFamily: "monospace", fontSize: "0.49rem", color: C.muted, marginTop: "0.1rem" }}>
              Cell: <span style={{ color: C.cyan }}>{entry.cell}</span>
            </div>
          )}
        </div>
        <div style={{ background: sm.color + "22", border: "1px solid " + sm.color + "55", borderRadius: "5px", padding: "0.2rem 0.55rem", flexShrink: 0 }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.47rem", color: sm.color, fontWeight: 700, letterSpacing: "0.04em" }}>{sm.label}</span>
        </div>
        <button onClick={() => setEditing(p => !p)} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "5px", padding: "0.2rem 0.55rem", color: C.muted, fontFamily: "monospace", fontSize: "0.5rem", cursor: "pointer", flexShrink: 0 }}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      {!editing && entry.notes && (
        <div style={{ padding: "0 0.85rem 0.55rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.54rem", color: "#506070", lineHeight: 1.5 }}>{entry.notes}</div>
        </div>
      )}

      {editing && (
        <div style={{ borderTop: "1px solid " + C.border, padding: "0.65rem 0.85rem", background: C.dim }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, marginBottom: "0.2rem", letterSpacing: "0.06em" }}>CELL ADDRESS (e.g. H1, A21–A47)</div>
            <input value={draftCell} onChange={e => setDraftCell(e.target.value)} placeholder="e.g. H1 or A21–A47"
              style={{ width: "100%", background: C.card, border: "1px solid " + C.border, borderRadius: "5px", padding: "0.38rem 0.55rem", color: C.text, fontFamily: "monospace", fontSize: "0.62rem", outline: "none", marginBottom: "0.35rem" }} />
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, marginBottom: "0.25rem", letterSpacing: "0.06em" }}>WHERE DOES THIS VALUE COME FROM?</div>
            <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
              {Object.entries(SOURCE_META).map(([src, m]) => (
                <button key={src} onClick={() => setDraftSource(src)} style={{ background: draftSource === src ? m.color + "22" : "transparent", border: "1px solid " + (draftSource === src ? m.color + "66" : C.border), borderRadius: "5px", padding: "0.25rem 0.6rem", color: draftSource === src ? m.color : C.muted, fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer" }}>
                  {m.label}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: SOURCE_META[draftSource]?.color || C.muted }}>{SOURCE_META[draftSource]?.desc}</div>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted, marginBottom: "0.2rem" }}>NOTES (plain English — what goes here)</div>
            <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} rows={2}
              style={{ width: "100%", background: C.card, border: "1px solid " + C.border, borderRadius: "5px", padding: "0.4rem 0.55rem", color: C.text, fontFamily: "monospace", fontSize: "0.6rem", lineHeight: 1.6, resize: "none", outline: "none" }} />
          </div>
          <button onClick={save} style={{ background: C.accent, border: "none", borderRadius: "6px", padding: "0.4rem 0.85rem", color: "#000", fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>Save</button>
        </div>
      )}
    </div>
  );
}

export default function FieldMappingEditor({ templateAnalysis, onUpdateMap, onClose }) {
  // Build the editable list from whatever Claude returned.
  // Prefer explicit cell_map. Fall back to reconstructing from fields arrays.
  const initialMap = useMemo(() => {
    if (!templateAnalysis) return [];
    if (Array.isArray(templateAnalysis.cell_map) && templateAnalysis.cell_map.length > 0) {
      return templateAnalysis.cell_map.map(e => ({
        field:  e.field   || e.name        || "Unknown field",
        cell:   e.cell    || e.address     || "",
        source: e.source  || "user",
        notes:  e.notes   || e.description || "",
      }));
    }
    // Reconstruct from auto_fillable / computed / required_user_inputs arrays
    const autoSet  = new Set(templateAnalysis.auto_fillable || []);
    const compSet  = new Set(templateAnalysis.computed       || []);
    const skipSet  = new Set(templateAnalysis.skip           || []);
    return (templateAnalysis.fields || []).map(f => ({
      field:  f,
      cell:   "",
      source: autoSet.has(f) ? "auto" : compSet.has(f) ? "computed" : skipSet.has(f) ? "skip" : "user",
      notes:  "",
    }));
  }, [templateAnalysis]);

  const [map, setMap] = useState(initialMap);
  const [filter, setFilter] = useState("all");

  const handleEdit = (index, updated) => {
    const next = map.map((e, i) => i === index ? updated : e);
    setMap(next);
    if (onUpdateMap) onUpdateMap(next);
  };

  const counts = useMemo(() => {
    const c = { auto: 0, user: 0, computed: 0, skip: 0 };
    map.forEach(e => { if (c[e.source] !== undefined) c[e.source]++; });
    return c;
  }, [map]);

  const filtered = (filter === "all" ? map.map((e, i) => [i, e]) : map.map((e, i) => [i, e]).filter(([, e]) => e.source === filter));
  const missingCells = map.some(e => !e.cell);

  if (!templateAnalysis) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", fontFamily: "'Syne', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap'); *{box-sizing:border-box} textarea,input{outline:none} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#1A2535;border-radius:2px}`}</style>

      <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", width: "100%", maxWidth: "680px", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "1rem 1.25rem 0.85rem", borderBottom: "1px solid " + C.border, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.6rem" }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "0.5rem", color: C.accent, letterSpacing: "0.1em", marginBottom: "0.2rem" }}>
                FIELD MAPPING {templateAnalysis.file_format ? "— " + templateAnalysis.file_format.toUpperCase() : ""}
              </div>
              <div style={{ fontWeight: 800, fontSize: "1.05rem", color: C.text }}>
                {templateAnalysis._fileName || "Uploaded form"}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.55rem", color: C.muted, marginTop: "0.15rem" }}>
                {templateAnalysis.summary || ""}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, marginTop: "0.3rem" }}>
                {counts.auto} auto-filled · {counts.user} you provide · {counts.computed > 0 ? counts.computed + " computed · " : ""}{counts.skip > 0 ? counts.skip + " skipped" : ""}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid " + C.border, borderRadius: "6px", padding: "0.35rem 0.7rem", color: C.muted, fontFamily: "monospace", fontSize: "0.6rem", cursor: "pointer", flexShrink: 0, marginLeft: "0.75rem" }}>Close ×</button>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.65rem" }}>
            {Object.entries(SOURCE_META).map(([, m]) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: m.color }} />
                <span style={{ fontFamily: "monospace", fontSize: "0.48rem", color: C.muted }}>{m.desc}</span>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
            {[["all", "All (" + map.length + ")"], ["auto", "Auto (" + counts.auto + ")"], ["user", "You provide (" + counts.user + ")"], ...(counts.computed > 0 ? [["computed", "Computed (" + counts.computed + ")"]] : []), ...(counts.skip > 0 ? [["skip", "Skip (" + counts.skip + ")"]] : [])].map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} style={{ background: filter === key ? C.accent : "transparent", border: "1px solid " + (filter === key ? C.accent : C.border), borderRadius: "5px", padding: "0.25rem 0.65rem", color: filter === key ? "#000" : C.muted, fontFamily: "monospace", fontSize: "0.52rem", cursor: "pointer", fontWeight: filter === key ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Warning if cell addresses are missing */}
        {missingCells && (
          <div style={{ padding: "0.55rem 1.25rem", background: C.gold + "0D", borderBottom: "1px solid " + C.gold + "22", flexShrink: 0 }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.gold, lineHeight: 1.55 }}>
              Some fields are missing exact cell addresses — the form was analyzed but cell locations couldn't be determined for every field. You can add them manually by clicking Edit.
            </div>
          </div>
        )}

        {/* Field list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.85rem 1.25rem" }}>
          {map.length === 0 ? (
            <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, textAlign: "center", padding: "2rem" }}>
              No fields were detected in this form.<br />Try uploading a different file format.
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ fontFamily: "monospace", fontSize: "0.6rem", color: C.muted, textAlign: "center", padding: "1.5rem" }}>
              No fields in this category.
            </div>
          ) : (
            filtered.map(([i, entry]) => (
              <FieldRow key={i} entry={entry} onEdit={(updated) => handleEdit(i, updated)} />
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid " + C.border, flexShrink: 0, display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: "0.52rem", color: C.muted, flex: 1, lineHeight: 1.5 }}>
            Changes apply on your next run.
          </div>
          <button onClick={onClose} style={{ background: "linear-gradient(135deg," + C.accent + ",#D97706)", border: "none", borderRadius: "7px", padding: "0.5rem 1.1rem", color: "#000", fontFamily: "monospace", fontSize: "0.62rem", fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}
