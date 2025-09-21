from __future__ import annotations

import os
import io
from typing import Iterator, List, Dict
from pypdf import PdfReader
from docx import Document as DocxDocument
try:
	import fitz  # PyMuPDF
except Exception:  # pragma: no cover
	fitz = None  # type: ignore

try:
	import pytesseract  # OCR engine wrapper; requires `tesseract` binary installed
	from PIL import Image
except Exception:  # pragma: no cover
	pytesseract = None  # type: ignore
	Image = None  # type: ignore


ALLOWED_EXTENSIONS = {".txt", ".pdf", ".docx"}
EXCLUDE_EXTENSIONS = {".xls", ".xlsx"}
EXCLUDE_DIR_NAMES = {
	"node_modules", "rag_env311", ".venv", "venv", "__pycache__",
	".git", ".hg", ".svn", ".mypy_cache", ".pytest_cache",
	"build", "dist", ".next", "logs"
}
EXCLUDE_DIR_PATTERNS = (
	"site-packages", "dist-info", "egg-info", "conda", "pip-",
	"virtualenv", "env", "ENV", ".tox", ".nox",
)

# Whitelist of top-level directories to process under the provided root.
# Case-insensitive match.
ALLOW_TOP_LEVEL_DIRS = {
	"ai",
	"automation",
	"business",
	"case files - translated",
	"case files-translated",
	"db",
	"ex_emp_backups",
	"minutes of meetings",
	"operation contracts",
	"ops",
	"policies",
	"powerly",
	"rfqs",
	"contracts",
	"translated contracts",
}

SKIP_TXT_DIR_HINTS = (
	"/src/", "/lib/", "/bin/", "/app/", "/tests/", "/__tests__/", "/spec/",
	"/vendor/", "/build/", "/include/", "/.github/",
)


def _iter_files(root_path: str) -> Iterator[str]:
    # If a single file is provided, yield it directly (subject to extension filters)
    if os.path.isfile(root_path):
        path = os.path.abspath(root_path)
        ext = os.path.splitext(path)[1].lower()
        if ext in EXCLUDE_EXTENSIONS:
            return
        if ext in ALLOWED_EXTENSIONS:
            yield path
        return

    root_abs = os.path.abspath(root_path)
    root_lower = root_abs.lower()
    for dirpath, dirnames, filenames in os.walk(root_abs):
        dirpath_abs = os.path.abspath(dirpath)
        dirpath_lower = dirpath_abs.lower()

        # Top-level whitelist: only descend into allowed folders directly under root
        if dirpath_lower == root_lower:
            dirnames[:] = [
                d for d in dirnames
                if d.lower() in ALLOW_TOP_LEVEL_DIRS
            ]
        else:
            # prune excluded directories in-place for efficiency
            dirnames[:] = [
                d for d in dirnames
                if d not in EXCLUDE_DIR_NAMES and not any(p in d for p in EXCLUDE_DIR_PATTERNS)
            ]

        # Special-case: exclude 'emails' subtree within 'case files - translated'
        rel_lower = os.path.relpath(dirpath_abs, root_abs).lower()
        if (
            rel_lower == "case files - translated" or rel_lower.startswith("case files - translated" + os.sep)
            or rel_lower == "case files-translated" or rel_lower.startswith("case files-translated" + os.sep)
        ):
            dirnames[:] = [d for d in dirnames if d.lower() != "emails"]

        # Do not ingest files at the root level, only within whitelisted top-level folders
        if dirpath_lower == root_lower:
            continue

        for name in filenames:
            path = os.path.join(dirpath_abs, name)
            ext = os.path.splitext(name)[1].lower()
            if ext in EXCLUDE_EXTENSIONS:
                continue
            if ext in ALLOWED_EXTENSIONS:
                yield path


def _read_text_txt(path: str) -> str:
	with open(path, "r", encoding="utf-8", errors="ignore") as f:
		return f.read()


def _read_text_pdf(path: str) -> str:
	# First try PyPDF
	text = ""
	try:
		with open(path, "rb") as f:
			reader = PdfReader(f)
			pages: List[str] = []
			for p in reader.pages:
				try:
					pages.append(p.extract_text() or "")
				except Exception:
					continue
			text = "\n".join(pages)
	except Exception:
		text = ""
	# Fallback to PyMuPDF for better Arabic handling if needed
	if (not text.strip() or len(text) < 80) and fitz is not None:
		try:
			doc = fitz.open(path)
			chunks: List[str] = []
			for page in doc:
				chunks.append(page.get_text("text") or "")
			doc.close()
			fallback_text = "\n".join(chunks)
			if fallback_text.strip():
				return fallback_text
		except Exception:
			pass
	# OCR fallback for scanned PDFs: render pages to images and run Tesseract (ara+eng)
	if (not text.strip() or len(text) < 80) and fitz is not None and pytesseract is not None and Image is not None:
		try:
			doc = fitz.open(path)
			ocr_chunks: List[str] = []
			for page in doc:
				pix = page.get_pixmap(dpi=300)
				# Convert pixmap to PIL Image via PNG bytes to handle alpha automatically
				png_bytes = pix.tobytes("png")
				im = Image.open(io.BytesIO(png_bytes))
				try:
					ocr_text = pytesseract.image_to_string(im, lang="ara+eng")
				except Exception:
					ocr_text = pytesseract.image_to_string(im)
				ocr_chunks.append(ocr_text or "")
			doc.close()
			ocr_out = "\n".join(ocr_chunks)
			if ocr_out.strip():
				return ocr_out
		except Exception:
			pass
	return text


def _read_text_docx(path: str) -> str:
	doc = DocxDocument(path)
	paras = [p.text for p in doc.paragraphs]
	return "\n".join(paras)
def _is_likely_code(text: str) -> bool:
	if not text:
		return False
	lines = text.splitlines()
	if not lines:
		return False
	sample = lines[:200]
	code_tokens = (
		"{", "}", ";", "def ", "class ", "import ", "from ", "#include",
		"public ", "private ", "function ", "=>", "var ", "let ", "const ",
		"using ", "package ", "namespace ", "<?php", "<html", "</",
	)
	token_hits = sum(any(tok in line for tok in code_tokens) for line in sample)
	ratio = token_hits / max(1, len(sample))
	non_alpha = sum(1 for ch in text[:20000] if not ch.isalnum() and ch not in "\n\t .,_-()[]")
	length = len(text[:20000])
	punct_ratio = non_alpha / max(1, length)
	return ratio > 0.30 or punct_ratio > 0.35



def _read_file_text(path: str) -> str:
	ext = os.path.splitext(path)[1].lower()
	if ext in (".txt",):
		return _read_text_txt(path)
	if ext == ".pdf":
		return _read_text_pdf(path)
	if ext == ".docx":
		return _read_text_docx(path)
	return ""


def _chunk_text(text: str, chunk_chars: int = 4000) -> List[str]:
	text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
	if not text:
		return []
	chunks: List[str] = []
	start = 0
	while start < len(text):
		end = min(len(text), start + chunk_chars)
		chunks.append(text[start:end])
		start = end
	return chunks


def collect_local_docs(root_path: str, chunk_chars: int = 4000) -> List[Dict[str, str]]:
	"""Recursively collect documents from local filesystem and return chunked docs.

	Each returned item is {"id": unique_id, "text": chunk_text}.
	"""
	docs: List[Dict[str, str]] = []
	for path in _iter_files(root_path):
		try:
			text = _read_file_text(path)
		except Exception:
			continue
		# Skip code-like .txt files and codey directories
		ext = os.path.splitext(path)[1].lower()
		if ext == ".txt":
			if any(hint in path for hint in SKIP_TXT_DIR_HINTS):
				continue
			if _is_likely_code(text):
				continue
		for idx, chunk in enumerate(_chunk_text(text, chunk_chars=chunk_chars)):
			chunk_id = f"file://{path}#chunk-{idx}"
			docs.append({"id": chunk_id, "text": chunk})
	return docs
