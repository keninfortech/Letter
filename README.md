# Word → E‑Signature → OCR PDF Portal (GitHub Pages)

## What it does
- Upload a **DOCX letter**
- Upload a **signature image** (PNG recommended, transparent background)
- Place the signature using **percent coordinates**
- Generates an **image-only PDF** (OCR-style):
  - Text is not selectable/copyable
  - Editing is difficult because each page is a single image
  - Printing works

## How it works (technical)
1. Renders DOCX to HTML using `docx-preview`.
2. Captures the rendered document using `html2canvas`.
3. Slices the captured canvas into A4-sized pages.
4. Overlays the signature on selected page(s).
5. Exports a PDF where each page is an embedded PNG (image-only).

## Limitations (important)
- DOCX rendering fidelity depends on browser fonts and the doc’s complexity.
  - Always check preview matches your DOCX layout.
- “OCR-style” image-only PDF is not a cryptographic guarantee:
  - Someone can still screenshot or run OCR on it.
- True “print-only encryption” (permissions flags) is best applied as a desktop step.

## Optional desktop hardening (print-only encryption)
After you download the signed OCR PDF, you can lock it locally using Python:

1) Install:
```bash
pip install pypdf
```
2) Run:
```bash
python lock_pdf.py input.pdf output_locked.pdf
```

`lock_pdf.py`
```python
from pypdf import PdfReader, PdfWriter

in_path = "input.pdf"
out_path = "output_locked.pdf"

reader = PdfReader(in_path)
writer = PdfWriter()
for p in reader.pages:
    writer.add_page(p)

# Print + High quality print only
writer.encrypt(
    user_password="",
    owner_password="",
    permissions_flag=(4 | 2048)
)

with open(out_path, "wb") as f:
    writer.write(f)

print("Locked PDF written:", out_path)
```

## Deploy to GitHub Pages
1) Upload all files to your GitHub repo root.
2) Settings → Pages → Deploy from branch → `main` / `/root`.
3) Open the Pages URL.

## Safety & compliance
Use this tool only for signatures you own or are authorized to apply.
