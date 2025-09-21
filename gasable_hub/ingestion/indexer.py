from __future__ import annotations

import os
from typing import Sequence

from llama_index.core import VectorStoreIndex, StorageContext, Document
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.vector_stores.postgres import PGVectorStore


def build_vector_store(table_name: str = "gasable_index", embed_dim: int = 1536) -> PGVectorStore:
	return PGVectorStore.from_params(
		database=os.getenv("PG_DBNAME", "gasable_db"),
		host=os.getenv("PG_HOST", "localhost"),
		port=int(os.getenv("PG_PORT", "5432")),
		user=os.getenv("PG_USER", os.getenv("USER", "postgres")),
		password=os.getenv("PG_PASSWORD", ""),
		table_name=table_name,
		embed_dim=embed_dim,
	)


def index_documents(docs: Sequence[dict], table_name: str = "gasable_index", embed_model_name: str = "text-embedding-3-small") -> None:
	embed_model = OpenAIEmbedding(model=embed_model_name)
	vector_store = build_vector_store(table_name=table_name, embed_dim=1536)
	storage_ctx = StorageContext.from_defaults(vector_store=vector_store)
	li_docs = [Document(text=d.get("text", ""), doc_id=d.get("id")) for d in docs]
	index = VectorStoreIndex.from_documents(li_docs, storage_context=storage_ctx, embed_model=embed_model)
	index.storage_context.persist()


