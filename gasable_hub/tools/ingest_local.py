import os
import sys
import argparse
import logging
from typing import Optional
from mcp.server.fastmcp import Context
from dotenv import load_dotenv

from gasable_hub.ingestion import local as local_ing
from gasable_hub.db.postgres import connect as pg_connect, run_migrations
from llama_index.embeddings.openai import OpenAIEmbedding

try:
	# Optional helpers for starting Postgres and applying SQL migrations via psql
	from run_hub import ensure_postgres_started, apply_migrations  # type: ignore
except Exception:  # pragma: no cover
	ensure_postgres_started = None  # type: ignore
	apply_migrations = None  # type: ignore


async def ingest_local(path: str, ctx: Context) -> dict:
	"""Ingest local files into the knowledge base. Placeholder implementation."""
	if not path:
		return {"status": "error", "error": "path is required"}
	if not os.path.exists(path):
		return {"status": "error", "error": f"path not found: {path}"}
	# TODO: Implement actual ingestion logic (e.g., chunking, embedding, storage)
	return {"status": "success", "path": path}


def register(mcp):
	@mcp.tool()
	async def ingest_local_tool(path: str, ctx: Context) -> dict:
		return await ingest_local(path, ctx)


def _setup_logger(log_file: Optional[str]) -> logging.Logger:
	logger = logging.getLogger("ingest_local")
	logger.setLevel(logging.INFO)
	if not logger.handlers:
		sh = logging.StreamHandler(sys.stdout)
		sh.setLevel(logging.INFO)
		sh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
		logger.addHandler(sh)
		if log_file:
			os.makedirs(os.path.dirname(log_file), exist_ok=True)
			fh = logging.FileHandler(log_file)
			fh.setLevel(logging.INFO)
			fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
			logger.addHandler(fh)
	return logger


def _require_openai_key(logger: logging.Logger) -> None:
	api_key = os.getenv("OPENAI_API_KEY")
	if not api_key:
		logger.error("OPENAI_API_KEY is not set. Please export it before running ingestion.")
		logger.error("Secrets to add: OPENAI_API_KEY")
		sys.exit(1)


def _ensure_db_ready(logger: logging.Logger) -> None:
	# Load env first so any configured PG_* vars are respected
	load_dotenv(override=True)
	try:
		if ensure_postgres_started:
			ensure_postgres_started()
	except Exception as e:  # pragma: no cover
		logger.warning(f"Could not auto-start Postgres (continuing): {e}")
	# Try robust apply via run_hub if available, else fallback to python migrations
	try:
		if apply_migrations:
			apply_migrations()
		else:
			applied = run_migrations()
			if applied:
				logger.info(f"Applied migrations: {applied}")
	except Exception as e:
		logger.error(f"Failed to apply migrations: {e}")
		sys.exit(1)


def ingest_path_with_llamaindex(
	path: str,
	chunk_chars: int = 4000,
	embed_model: str = "text-embedding-3-small",
	log_file: Optional[str] = None,
	resume: bool = False,
) -> None:
	"""Stream-ingest a folder using LlamaIndex embeddings into public.gasable_index.

	- Per-file progress is logged to STDOUT (and optional log file).
	- Uses LlamaIndex OpenAIEmbedding for embedding generation.
	- Inserts into table public.gasable_index (node_id, text, embedding, li_metadata).
	"""
	logger = _setup_logger(log_file)
	_setup_logger(log_file)  # ensure handlers exist
	_ensure_db_ready(logger)
	_require_openai_key(logger)

	if not os.path.exists(path):
		logger.error(f"Path not found: {path}")
		sys.exit(1)

	embedder = OpenAIEmbedding(model=embed_model)
	processed_files = 0
	processed_chunks = 0
	inserted_rows = 0

	logger.info(f"Starting ingestion from: {path}")
	logger.info(f"Chunk size: {chunk_chars} chars; Embed model: {embed_model}")

	with pg_connect() as conn:
		with conn.cursor() as cur:
			existing_ids: set[str] = set()
			if resume:
				try:
					prefix = f"file://{os.path.abspath(path).rstrip('/')}/%"
					cur.execute("SELECT node_id FROM public.gasable_index WHERE node_id LIKE %s", (prefix,))
					existing_ids = {row[0] for row in cur.fetchall()}
					logger.info(f"Resume enabled: found {len(existing_ids)} existing chunks to skip")
				except Exception as e:
					logger.warning(f"Resume pre-scan failed (continuing without resume): {e}")
					existing_ids = set()
			for file_path in local_ing._iter_files(path):
				processed_files += 1
				logger.info(f"Processing file: {file_path}")
				try:
					text = local_ing._read_file_text(file_path)
				except Exception as e:
					logger.warning(f"Skipping file due to read error: {e}")
					continue
				chunks = local_ing._chunk_text(text, chunk_chars=chunk_chars)
				if not chunks:
					logger.info("  -> 0 chunks")
					continue
				for idx, chunk in enumerate(chunks):
					processed_chunks += 1
					doc_id = f"file://{file_path}#chunk-{idx}"
					if resume and doc_id in existing_ids:
						# Already present; skip embedding and upsert
						continue
					try:
						# Sanitize text to avoid NUL and control characters in DB literal
						clean_chunk = chunk.replace("\x00", " ")
						clean_chunk = "".join(ch if ord(ch) >= 32 or ch in "\n\t" else " " for ch in clean_chunk)
						vec = embedder.get_text_embedding(clean_chunk)
						vec_str = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
						cur.execute(
							"""
							INSERT INTO public.gasable_index (node_id, text, embedding, li_metadata)
							VALUES (%s, %s, %s::vector, '{}'::jsonb)
							ON CONFLICT (node_id) DO UPDATE SET text=EXCLUDED.text, embedding=EXCLUDED.embedding
							""",
							(doc_id, clean_chunk, vec_str),
						)
						inserted_rows += 1
						if inserted_rows % 50 == 0:
							conn.commit()
							logger.info(f"  -> committed {inserted_rows} rows so far")
					except Exception as e:
						logger.error(f"  -> failed to index chunk {idx}: {e}")
						conn.rollback()
						continue
				logger.info(f"  -> chunks processed: {len(chunks)}")
			conn.commit()

	logger.info(
		f"Completed ingestion. Files: {processed_files}, Chunks: {processed_chunks}, Rows written: {inserted_rows}"
	)


def main() -> None:
	load_dotenv(override=True)
	parser = argparse.ArgumentParser(description="Ingest local folder into PGVector using LlamaIndex embeddings")
	parser.add_argument("--path", default=os.getenv("LOCAL_INGEST_PATH", "/Users/hrn/Desktop/Gasable_hrn"), help="Root folder to ingest")
	parser.add_argument("--chunk-chars", type=int, default=int(os.getenv("CHUNK_CHARS", "4000")), help="Characters per chunk")
	parser.add_argument("--embed-model", default=os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small"), help="OpenAI embedding model for LlamaIndex")
	parser.add_argument("--log-file", default=os.getenv("INGEST_LOG_FILE", "logs/run_local_ingest.log"), help="Optional log file path")
	parser.add_argument("--resume", action="store_true", help="Skip chunks already present in public.gasable_index")
	args = parser.parse_args()

	ingest_path_with_llamaindex(
		path=args.path,
		chunk_chars=args.chunk_chars,
		embed_model=args.embed_model,
		log_file=args.log_file,
		resume=args.resume,
	)


if __name__ == "__main__":
	main()


