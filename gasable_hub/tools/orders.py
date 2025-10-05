from __future__ import annotations

import os
import requests
try:
	from mcp.server.fastmcp import Context  # type: ignore
except Exception:  # pragma: no cover
	class Context:  # type: ignore
		pass
import time
import uuid


def register(mcp):
	@mcp.tool()
	def orders_place(product_id: str, quantity: int, user_id: str, address: str, ctx: Context | None = None) -> dict:
		"""Place an order in Gasable marketplace and return invoice JSON."""
		base = (os.getenv("GASABLE_API_BASE") or "").rstrip("/")
		key = os.getenv("GASABLE_API_KEY") or ""
		# Sandbox mode to enable end-to-end testing without marketplace API
		if os.getenv("GASABLE_ORDER_SANDBOX", "0") in ("1", "true", "True") or not base:
			inv_id = f"sandbox-{uuid.uuid4().hex[:8]}"
			amount = max(1, int(quantity)) * 100.0
			return {
				"status": "ok",
				"invoice": {
					"id": inv_id,
					"status": "sandbox",
					"product_id": product_id,
					"quantity": int(quantity),
					"user_id": user_id,
					"address": address,
					"currency": "USD",
					"amount": amount,
					"created_at": int(time.time()),
				},
			}
		try:
			resp = requests.post(
				base + "/internal/orders",
				headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
				json={"product_id": product_id, "qty": int(quantity), "user_id": user_id, "address": address},
				timeout=30,
			)
			resp.raise_for_status()
			data = resp.json()
			return {"status": "ok", "invoice": data}
		except Exception as e:
			return {"status": "error", "error": str(e)}


