from __future__ import annotations

import os
import re
import time
from typing import Iterable, List, Dict, Tuple

from urllib.parse import urlparse, urljoin
import requests
import tempfile
from bs4 import BeautifulSoup  # type: ignore
from . import local as local_ing

try:
	from duckduckgo_search import DDGS  # type: ignore
except Exception:  # pragma: no cover
	DDGS = None  # type: ignore

try:
	import trafilatura  # type: ignore
except Exception:  # pragma: no cover
	trafilatura = None  # type: ignore
try:
	from trafilatura.sitemaps import sitemap_search, sitemap  # type: ignore
except Exception:  # pragma: no cover
	sitemap_search = None  # type: ignore
	sitemap = None  # type: ignore

try:
	# Optional Firecrawl client (cloud API). We prefer local OS server if available.
	import firecrawl  # type: ignore
except Exception:  # pragma: no cover
	firecrawl = None  # type: ignore


ARABIC_RE = re.compile(r"[\u0600-\u06FF]")


def _now_iso() -> str:
	return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _chunk_text(text: str, chunk_chars: int = 4000) -> List[str]:
	text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
	if not text:
		return []
	chunks: List[str] = []
	start = 0
	while start < len(text):
		end = min(len(text), start + chunk_chars)
		chunks.append(text[start:end])
		start = end
	return chunks


def _norm_url(url: str) -> str:
	url = url.strip()
	if url.startswith("http://") or url.startswith("https://"):
		return url
	return "https://" + url


def search_duckduckgo(queries: Iterable[str], max_results: int = 10, allow_domains: Iterable[str] | None = None) -> List[str]:
	"""Return unique URLs from DuckDuckGo for given queries, optionally filtered by domains."""
	allow_set = {d.lower() for d in (allow_domains or [])}
	urls: List[str] = []
	seen: set[str] = set()
	if DDGS is None:
		return []
	with DDGS() as dd:
		for q in queries:
			try:
				for row in dd.text(q, max_results=max_results):
					u = row.get("href") or row.get("url") or ""
					if not u:
						continue
					u = _norm_url(u)
					netloc = urlparse(u).netloc.lower()
					if allow_set and not any(netloc.endswith(dom) for dom in allow_set):
						continue
					if u in seen:
						continue
					seen.add(u)
					urls.append(u)
			except Exception:
				continue
	return urls


def extract_with_trafilatura(url: str) -> Tuple[str, str]:
	"""Return (title, text) extracted by trafilatura; empty strings on failure."""
	if trafilatura is None:
		return "", ""
	try:
		# HTTP fetch with realistic browser headers (more reliable with CDNs)
		headers = {
			"User-Agent": os.getenv(
				"SCRAPER_UA",
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
			),
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": os.getenv("SCRAPER_ACCEPT_LANGUAGE", "ar-SA,ar;q=0.9,en;q=0.8"),
			"Cache-Control": "no-cache",
			"Pragma": "no-cache",
		}
		resp = requests.get(url, headers=headers, timeout=40, allow_redirects=True)
		if not resp.ok or not resp.text:
			return "", ""
		txt = trafilatura.extract(resp.text, url=url, include_comments=False, include_tables=False, favor_recall=False) or ""
		title = ""
		try:
			meta = trafilatura.extract_metadata(resp.text) if hasattr(trafilatura, "extract_metadata") else None
			title = (getattr(meta, "title", None) or "") if meta else ""
		except Exception:
			pass
		return title or "", txt or ""
	except Exception:
		return "", ""


def extract_with_bs4(url: str) -> Tuple[str, str]:
	"""Very simple HTML extractor using BeautifulSoup as a last-resort fallback."""
	try:
		headers = {
			"User-Agent": os.getenv(
				"SCRAPER_UA",
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
			),
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": os.getenv("SCRAPER_ACCEPT_LANGUAGE", "ar-SA,ar;q=0.9,en;q=0.8"),
		}
		resp = requests.get(url, headers=headers, timeout=40, allow_redirects=True)
		if not resp.ok or not resp.text:
			return "", ""
		soup = BeautifulSoup(resp.text, "html.parser")
		for tag in soup(["script", "style", "noscript", "template"]):
			tag.extract()
		title = ""
		if soup.title and soup.title.string:
			title = soup.title.string.strip()
		# Prefer common content containers
		candidates = []
		for selector in [
			"article",
			"main",
			"div.entry-content",
			"div.post-content",
			"section",
		]:
			for node in soup.select(selector):
				txt = node.get_text(separator="\n", strip=True)
				if txt and len(txt) > 200:
					candidates.append(txt)
		text = "\n\n".join(candidates) if candidates else soup.get_text(separator="\n", strip=True)
		# basic cleanup
		text = re.sub(r"\n{3,}", "\n\n", text).strip()
		return title, text
	except Exception:
		return "", ""


def extract_with_firecrawl(url: str) -> Tuple[str, str]:
	"""Return (title, text) via Firecrawl.

	Priority:
	1) Local open-source server (FIRECRAWL_BASE_URL, defaults to http://127.0.0.1:3002)
	2) Python client (cloud API) if installed
	"""
	base = os.getenv("FIRECRAWL_BASE_URL", "http://127.0.0.1:3002").rstrip("/")
	for endpoint in ("/v1/scrape", "/v0/scrape", "/extract", "/scrape"):
		try:
			resp = requests.post(base + endpoint, json={"url": url}, timeout=40)
			if resp.ok:
				data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
				# Common shapes: { title, content } or { data: { title, markdown|content } }
				if isinstance(data, dict):
					d = data.get("data") if isinstance(data.get("data"), dict) else data
					title = (d.get("title") if isinstance(d, dict) else "") or ""
					text = (d.get("content") or d.get("markdown") or d.get("text") or "") if isinstance(d, dict) else ""
					if text:
						return title, text
		except Exception:
			pass
	# Fallback to python client if present
	if firecrawl is not None:
		try:
			if hasattr(firecrawl, "fetch"):
				res = firecrawl.fetch(url)  # type: ignore[attr-defined]
				title = (res.get("title") if isinstance(res, dict) else "") or ""
				text = (res.get("content") if isinstance(res, dict) else "") or ""
				return title, text
		except Exception:
			return "", ""
	return "", ""


def scrape_url(url: str) -> Dict[str, str]:
	"""Scrape a single URL to a doc dict: {id, text, metadata}.

	Prefer Firecrawl if present; otherwise use trafilatura.
	"""
	url = _norm_url(url)
	# Binary formats first (PDF/DOCX/TXT)
	lower = url.lower()
	try:
		if lower.endswith(".pdf"):
			resp = requests.get(url, headers={"User-Agent": os.getenv("SCRAPER_UA", "Mozilla/5.0")}, timeout=30)
			if resp.ok:
				with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
					tmp.write(resp.content)
					tmp.flush()
					text = local_ing._read_text_pdf(tmp.name)
					if text.strip():
						return {"url": url, "title": "", "text": text, "scraped_at": _now_iso()}
		elif lower.endswith(".docx"):
			resp = requests.get(url, headers={"User-Agent": os.getenv("SCRAPER_UA", "Mozilla/5.0")}, timeout=30)
			if resp.ok:
				with tempfile.NamedTemporaryFile(suffix=".docx", delete=True) as tmp:
					tmp.write(resp.content)
					tmp.flush()
					text = local_ing._read_text_docx(tmp.name)
					if text.strip():
						return {"url": url, "title": "", "text": text, "scraped_at": _now_iso()}
		elif lower.endswith(".txt"):
			resp = requests.get(url, headers={"User-Agent": os.getenv("SCRAPER_UA", "Mozilla/5.0")}, timeout=30)
			if resp.ok and resp.text.strip():
				return {"url": url, "title": "", "text": resp.text, "scraped_at": _now_iso()}
	except Exception:
		pass

	# Firecrawl/HTML next
	title, text = extract_with_firecrawl(url)
	if not text:
		# Fallback to trafilatura
		title2, text2 = extract_with_trafilatura(url)
		if text2:
			title = title or title2
			text = text2
	if not text:
		# Last resort: BeautifulSoup generic extractor
		title3, text3 = extract_with_bs4(url)
		if text3:
			title = title or title3
			text = text3
	if not text:
		return {}
	chunks = _chunk_text(text, chunk_chars=int(os.getenv("CHUNK_CHARS", "4000")))
	if not chunks:
		return {}
	# Return the first chunk as aggregate doc; the caller will expand to multiple chunk docs if needed
	return {
		"url": url,
		"title": title or "",
		"text": text,
		"scraped_at": _now_iso(),
	}


def build_chunked_docs(urls: Iterable[str], chunk_chars: int = 4000) -> List[Dict[str, str]]:
	"""Scrape a list of URLs and return chunked docs suitable for upsert_embeddings.

	Each doc is {id: web://URL#chunk-i, text: chunk_text}.
	"""
	out: List[Dict[str, str]] = []
	for url in urls:
		data = scrape_url(url)
		if not data:
			continue
		text = data.get("text", "")
		for idx, chunk in enumerate(_chunk_text(text, chunk_chars=chunk_chars)):
			out.append({
				"id": f"web://{data['url']}#chunk-{idx}",
				"text": chunk,
			})
	return out


def firecrawl_local_crawl(base_url: str, max_pages: int = 200) -> List[Dict[str, str]]:
	"""Use local Firecrawl OS to crawl a site and return page dicts by polling the v1 API.

	Returns a list of {url, title, text}.
	"""
	base = os.getenv("FIRECRAWL_BASE_URL", "http://127.0.0.1:3002").rstrip("/")
	start_url = _norm_url(base_url)
	payload = {
		"url": start_url,
		"crawlerOptions": {"limit": max_pages},
		"scrapeOptions": {"formats": ["markdown", "text"]},
	}
	try:
		# Kick off crawl job
		create = requests.post(base + "/v1/crawl", json=payload, timeout=40)
		if not create.ok:
			return []
		cj = create.json() if create.headers.get("content-type", "").startswith("application/json") else {}
		status_url = None
		if isinstance(cj, dict):
			# Prefer url to poll, else compose from id
			status_url = cj.get("url") or (base + "/v1/crawl/" + str(cj.get("id"))) if cj.get("id") else None
		if not status_url:
			return []

		pages: List[Dict[str, str]] = []
		# Poll for results; follow pagination via "next"
		deadline = time.time() + 300  # 5 minutes cap
		next_url = status_url
		while next_url and len(pages) < max_pages and time.time() < deadline:
			r = requests.get(next_url, timeout=40)
			if not r.ok:
				time.sleep(1.0)
				continue
			sj = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
			items = sj.get("data") if isinstance(sj, dict) else []
			if isinstance(items, list):
				for item in items:
					if not isinstance(item, dict):
						continue
					u = str(item.get("url") or start_url)
					t = str(item.get("title") or "")
					txt = str(item.get("markdown") or item.get("content") or item.get("text") or "")
					if not txt:
						continue
					pages.append({"url": _norm_url(u), "title": t, "text": txt})
					if len(pages) >= max_pages:
						break
			# Determine next step
			nxt = sj.get("next") if isinstance(sj, dict) else None
			status = sj.get("status") if isinstance(sj, dict) else None
			if nxt and len(pages) < max_pages:
				next_url = nxt
			elif status and status.lower() in ("completed", "failed"):
				break
			else:
				# Keep polling same status URL
				time.sleep(1.0)
		return pages[:max_pages]
	except Exception:
		return []


def build_docs_from_firecrawl_pages(pages: List[Dict[str, str]], chunk_chars: int = 4000) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for p in pages:
        url = p.get("url") or ""
        text = p.get("text") or ""
        if not url or not text:
            continue
        for idx, chunk in enumerate(_chunk_text(text, chunk_chars=chunk_chars)):
            out.append({
                "id": f"web://{url}#chunk-{idx}",
                "text": chunk,
            })
    return out


def discover_site_urls(base_url: str, max_urls: int = 200) -> List[str]:
	"""Use sitemap discovery to enumerate URLs for a site, fallback to just the base URL.

	Returns normalized URLs (https scheme) limited by max_urls.
	"""
	base = _norm_url(base_url)
	if sitemap_search is None or sitemap is None:
		return [base]
	urls: List[str] = []
	try:
		smaps = list(sitemap_search(base)) if sitemap_search else []
		for sm in smaps:
			try:
				for u in sitemap(sm):
					urls.append(_norm_url(u))
					if len(urls) >= max_urls:
						break
			except Exception:
				continue
	except Exception:
		pass
	if not urls:
		# Fallback: fetch homepage and extract same-domain links and PDFs
		try:
			headers = {"User-Agent": os.getenv("SCRAPER_UA", "Mozilla/5.0 (compatible; GasableBot/1.0)")}
			resp = requests.get(base, headers=headers, timeout=20)
			if resp.ok and resp.text:
				soup = BeautifulSoup(resp.text, "html.parser")
				netloc = urlparse(base).netloc.lower()
				tmp: List[str] = []
				for a in soup.find_all("a"):
					href = a.get("href")
					if not href:
						continue
					u = urljoin(base, href)
					p = urlparse(u)
					if not p.scheme.startswith("http"):
						continue
					if p.netloc.lower().endswith(netloc):
						tmp.append(_norm_url(u))
				urls = [base] + tmp
		except Exception:
			urls = [base]
	# De-duplicate while preserving order
	seen: set[str] = set()
	out: List[str] = []
	for u in urls:
		if u in seen:
			continue
		seen.add(u)
		out.append(u)
	return out[:max_urls]


def crawl_site_urls(base_url: str, max_pages: int = 100) -> List[str]:
	"""BFS crawl limited to same-domain URLs, returning a de-duplicated URL list.

	Includes PDFs/DOCX/TXT and HTML pages. Respects max_pages.
	"""
	start = _norm_url(base_url)
	base_netloc = urlparse(start).netloc.lower()
	queue: List[str] = [start]
	visited: set[str] = set()
	collected: List[str] = []
	headers = {"User-Agent": os.getenv("SCRAPER_UA", "Mozilla/5.0 (compatible; GasableBot/1.0)")}
	while queue and len(collected) < max_pages:
		url = queue.pop(0)
		if url in visited:
			continue
		visited.add(url)
		collected.append(url)
		# Only follow links on HTML pages
		try:
			if any(url.lower().endswith(ext) for ext in (".pdf", ".docx", ".txt")):
				continue
			resp = requests.get(url, headers=headers, timeout=20)
			if not resp.ok or not resp.text:
				continue
			soup = BeautifulSoup(resp.text, "html.parser")
			for a in soup.find_all("a"):
				href = a.get("href")
				if not href:
					continue
				u = urljoin(url, href)
				p = urlparse(u)
				if not p.scheme.startswith("http"):
					continue
				if p.netloc.lower().endswith(base_netloc):
					u = _norm_url(u)
					if u not in visited and u not in queue:
						queue.append(u)
		except Exception:
			continue
	return collected[:max_pages]


