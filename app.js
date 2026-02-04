/* global docx, html2canvas, PDFLib */

const state = {
  docxArrayBuffer: null,
  sigBytes: null,
  sigMime: null,
  sigImgEl: null,
  pageCount: 0,
  pageCanvases: [],  // sliced pages (canvas per page)
};

const el = (id) => document.getElementById(id);
const sInputs = (m) => (el("statusInputs").textContent = m);
const sPrev = (m) => (el("statusPreview").textContent = m);
const sGen = (m) => (el("statusGen").textContent = m);

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function getPlacement() {
  const xPct = clamp(parseFloat(el("posX").value) || 0, 0, 100) / 100;
  const yPct = clamp(parseFloat(el("posY").value) || 0, 0, 100) / 100;
  const wPct = clamp(parseFloat(el("sigW").value) || 20, 1, 100) / 100;
  return { xPct, yPct, wPct };
}

function setRangeEnabled() {
  const mode = el("pageMode").value;
  const on = mode === "range";
  el("pageFrom").disabled = !on;
  el("pageTo").disabled = !on;
}

function getSelectedPages() {
  const mode = el("pageMode").value;
  if (!state.pageCount) return new Set();

  if (mode === "all") return new Set(Array.from({ length: state.pageCount }, (_, i) => i + 1));
  if (mode === "range") {
    const from = clamp(parseInt(el("pageFrom").value, 10) || 1, 1, state.pageCount);
    const to = clamp(parseInt(el("pageTo").value, 10) || state.pageCount, 1, state.pageCount);
    const a = Math.min(from, to), b = Math.max(from, to);
    return new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));
  }
  // last
  return new Set([state.pageCount]);
}

async function loadDocx(file) {
  state.docxArrayBuffer = await file.arrayBuffer();

  const host = el("docxHost");
  host.innerHTML = "";

  // Render docx → HTML
  await docx.renderAsync(state.docxArrayBuffer, host, null, {
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    className: "docx",
  });

  sInputs(`Loaded DOCX: ${file.name}`);
  sPrev("DOCX rendered. Click Preview to slice pages.");
}

async function loadSignature(file) {
  state.sigBytes = await file.arrayBuffer();
  state.sigMime = file.type || "image/png";

  const blob = new Blob([state.sigBytes], { type: state.sigMime });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    state.sigImgEl = img;
    URL.revokeObjectURL(url);
    sInputs(`${el("statusInputs").textContent} • Signature loaded: ${file.name}`);
  };
  img.src = url;
}

function drawSignatureOnCanvas(canvas, placement) {
  if (!state.sigImgEl) throw new Error("Signature image not loaded.");
  const ctx = canvas.getContext("2d");

  const pageW = canvas.width;
  const pageH = canvas.height;

  const sigW = pageW * placement.wPct;
  const aspect = state.sigImgEl.width / state.sigImgEl.height;
  const sigH = sigW / aspect;

  const x = pageW * placement.xPct;
  const yFromBottom = pageH * placement.yPct;
  const y = pageH - yFromBottom - sigH;

  ctx.drawImage(state.sigImgEl, x, y, sigW, sigH);
}

async function sliceRenderedDocxToPages() {
  const scale = parseInt(el("scale").value, 10) || 2;
  const host = el("docxHost");

  // Capture full rendered document as a single canvas
  const fullCanvas = await html2canvas(host, {
    backgroundColor: "#ffffff",
    scale,
    useCORS: true,
  });

  // Define page size in pixels based on A4 ratio.
  // Since we forced width ~A4 at 96dpi, capture keeps consistent ratio.
  const pageW = fullCanvas.width;
  const pageH = Math.round(pageW * (1123 / 794)); // A4 height/width ratio at 96dpi
  const pages = [];

  for (let y = 0; y < fullCanvas.height; y += pageH) {
    const h = Math.min(pageH, fullCanvas.height - y);
    const c = document.createElement("canvas");
    c.width = pageW;
    c.height = pageH; // keep fixed page height; pad bottom white if last is shorter
    const ctx = c.getContext("2d");

    // Fill white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.drawImage(fullCanvas, 0, y, pageW, h, 0, 0, pageW, h);
    pages.push(c);
  }

  state.pageCanvases = pages;
  state.pageCount = pages.length;
  el("pageFrom").value = 1;
  el("pageTo").value = state.pageCount;

  return pages;
}

async function preview() {
  try {
    if (!state.docxArrayBuffer) return sPrev("Upload a DOCX first.");
    if (!state.sigImgEl) return sPrev("Upload a signature image first.");

    sPrev("Rendering + slicing pages...");
    const pages = await sliceRenderedDocxToPages();

    // Draw signature on the first selected page for preview purposes (default last page)
    const selected = getSelectedPages();
    const placement = getPlacement();
    const pageNum = Math.min(1, state.pageCount);
    const canvas = pages[pageNum - 1];

    // Preview page 1: show without signature unless page 1 is selected; for visibility, always overlay a faint signature if not selected
    const previewCanvas = el("previewCanvas");
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    const ctx = previewCanvas.getContext("2d");
    ctx.drawImage(canvas, 0, 0);

    // If page 1 is selected, apply signature; otherwise show a translucent "ghost" for alignment feedback
    if (selected.has(1)) {
      drawSignatureOnCanvas(previewCanvas, placement);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.35;
      drawSignatureOnCanvas(previewCanvas, placement);
      ctx.restore();
    }

    sPrev(`Sliced ${state.pageCount} page(s). Preview shows page 1 (ghost signature if not selected).`);
    sGen("Ready.");
  } catch (e) {
    console.error(e);
    sPrev(`Preview error: ${e.message}`);
  }
}

async function canvasToPngBytes(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      const buf = await blob.arrayBuffer();
      resolve(new Uint8Array(buf));
    }, "image/png");
  });
}

async function generatePdf() {
  if (!state.docxArrayBuffer) throw new Error("DOCX not loaded.");
  if (!state.sigImgEl) throw new Error("Signature image not loaded.");

  // Ensure pages are ready
  if (!state.pageCanvases.length) {
    sGen("Slicing pages...");
    await sliceRenderedDocxToPages();
  }

  const selected = getSelectedPages();
  const placement = getPlacement();

  // Apply signature onto the selected pages (clone canvases so repeated clicks don't double-apply)
  const pageCanvases = state.pageCanvases.map((c) => {
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    copy.getContext("2d").drawImage(c, 0, 0);
    return copy;
  });

  for (let i = 0; i < pageCanvases.length; i++) {
    const pageNum = i + 1;
    if (selected.has(pageNum)) {
      drawSignatureOnCanvas(pageCanvases[i], placement);
    }
  }

  const { PDFDocument } = PDFLib;
  const out = await PDFDocument.create();

  for (const c of pageCanvases) {
    const pngBytes = await canvasToPngBytes(c);
    const img = await out.embedPng(pngBytes);
    const page = out.addPage([c.width, c.height]);
    page.drawImage(img, { x: 0, y: 0, width: c.width, height: c.height });
  }

  return await out.save();
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function generate() {
  try {
    if (!state.docxArrayBuffer) return sGen("Upload a DOCX letter first.");
    if (!state.sigImgEl) return sGen("Upload a signature image first.");

    const outBase = (el("outName").value || "SIGNED_OCR_LETTER").trim().replace(/[^\w\-]+/g, "_");
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"").slice(0,14);
    const outName = `${outBase}_${stamp}.pdf`;

    sGen("Generating OCR PDF...");
    const bytes = await generatePdf();
    downloadBytes(bytes, outName);
    sGen(`Done. Downloaded: ${outName}`);
  } catch (e) {
    console.error(e);
    sGen(`Error: ${e.message}`);
  }
}

function resetAll() {
  state.docxArrayBuffer = null;
  state.sigBytes = null;
  state.sigMime = null;
  state.sigImgEl = null;
  state.pageCount = 0;
  state.pageCanvases = [];
  el("docxHost").innerHTML = "";
  el("docxFile").value = "";
  el("sigFile").value = "";

  const canvas = el("previewCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);

  sInputs("No files loaded.");
  sPrev("No preview yet.");
  sGen("Ready.");
}

function wire() {
  el("docxFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await loadDocx(f);
  });

  el("sigFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await loadSignature(f);
  });

  el("pageMode").addEventListener("change", setRangeEnabled);
  setRangeEnabled();

  el("btnPreview").addEventListener("click", preview);
  el("btnGenerate").addEventListener("click", generate);
  el("btnReset").addEventListener("click", resetAll);
}

document.addEventListener("DOMContentLoaded", wire);
