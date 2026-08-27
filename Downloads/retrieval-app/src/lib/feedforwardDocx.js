// Feedforward .docx builder — the "agreed style" (bordered-box HGO) per the feedforward Skill.
//
// Takes the STRUCTURED feedforward spec (produced by the paper-feedforward server route from a
// OpenAI call) and deterministically renders a one-page A4 Word document: one bordered, page-safe
// box per struggled question, each with a "Remember" line, two parallel exam-style questions with
// mark tariffs + command words, and a faint mark-scheme line. Pupils answer in their books, so no
// answer lines are added.
//
// Why deterministic build (not "ask the model for HTML/docx"): the Skill mandates cantSplit boxes,
// per-box numbering and italic diagram placeholders that a model emits inconsistently. We control
// the layout; the model only supplies the pedagogy (the JSON).
//
// Input shape (all fields defensive):
//   {
//     title?: string,                 // sheet title
//     className?: string,             // for the name/date line
//     subject?: string,
//     boxes: [{
//       heading: string,             // topic / what the question tested
//       remember: string,            // 2-3 sentence core idea
//       questions: [{ text, marks?, command? }],   // parallel practice (usually 2)
//       markScheme?: string,         // faint creditworthy-points line
//       diagram?: string             // optional placeholder caption (italic grey)
//     }]
//   }
// Returns a Node Buffer (the .docx bytes).

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  BorderStyle, WidthType, AlignmentType, HeadingLevel, convertMillimetersToTwip,
} from "docx";

const FONT = "Arial";
const GREY = "808080";
const BOX_BORDER = { style: BorderStyle.SINGLE, size: 6, color: "333333" };
const ALL_BORDERS = { top: BOX_BORDER, bottom: BOX_BORDER, left: BOX_BORDER, right: BOX_BORDER };

// docx sizes are half-points; 22 = 11pt body, 24 = 12pt box heading, 18 = 9pt fine print.
function run(text, opts = {}) {
  return new TextRun({ text: String(text ?? ""), font: FONT, size: 22, ...opts });
}

function marksLabel(marks) {
  const m = Number(marks);
  if (!Number.isFinite(m) || m <= 0) return "";
  return `  (${m} mark${m > 1 ? "s" : ""})`;
}

function questionBox(box, index) {
  const children = [];

  // 1. Box heading: "1. Topic" — 12pt bold.
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: `${index}. ${box.heading || "Practice"}`, font: FONT, size: 24, bold: true })],
  }));

  // 2. Remember line.
  if (box.remember) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [run("Remember: ", { bold: true }), run(box.remember)],
    }));
  }

  // 3. Parallel exam-style questions, numbered within the box (restarts each box).
  (box.questions || []).forEach((q, i) => {
    const command = q.command ? `${String(q.command).trim()} ` : "";
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: `${String.fromCharCode(97 + i)}) `, font: FONT, size: 22, bold: true }), // a) b) c)
        run(`${command}${q.text || ""}`),
        new TextRun({ text: marksLabel(q.marks), font: FONT, size: 22, bold: true }),
      ],
    }));
  });

  // Optional diagram placeholder — italic grey, never a redrawn diagram (Skill rule).
  if (box.diagram) {
    children.push(new Paragraph({
      spacing: { before: 40 },
      children: [new TextRun({ text: `[ Diagram: ${box.diagram} ]`, font: FONT, size: 20, italics: true, color: GREY })],
    }));
  }

  // 4. Faint mark-scheme line.
  if (box.markScheme) {
    children.push(new Paragraph({
      spacing: { before: 60 },
      children: [new TextRun({ text: `Mark scheme: ${box.markScheme}`, font: FONT, size: 18, italics: true, color: GREY })],
    }));
  }

  // Single-cell bordered table, kept on one page via cantSplit.
  const cell = new TableCell({
    children,
    borders: ALL_BORDERS,
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ cantSplit: true, children: [cell] })],
  });
}

export function buildFeedforwardDocx(spec = {}) {
  const boxes = Array.isArray(spec.boxes) ? spec.boxes : [];
  const title = spec.title || "Feedforward — exam feedback practice";

  const body = [];
  // Title.
  body.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 40 },
    children: [new TextRun({ text: title, font: FONT, size: 30, bold: true })],
  }));
  // Name / date line.
  body.push(new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({ text: `Name: ${"_".repeat(28)}    Class: ${spec.className || "________"}    Date: ${"_".repeat(12)}`, font: FONT, size: 20, color: GREY }),
    ],
  }));

  if (boxes.length === 0) {
    body.push(new Paragraph({ children: [run("No questions were provided for this feedforward sheet.")] }));
  }
  boxes.forEach((box, i) => {
    body.push(questionBox(box, i + 1));
    body.push(new Paragraph({ spacing: { after: 120 }, children: [] })); // gap between boxes
  });

  const doc = new Document({
    creator: "retrieval-app",
    title,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) }, // A4 portrait
          margin: {
            top: convertMillimetersToTwip(15), bottom: convertMillimetersToTwip(15),
            left: convertMillimetersToTwip(15), right: convertMillimetersToTwip(15),
          },
        },
      },
      children: body,
    }],
  });

  return Packer.toBuffer(doc);
}
