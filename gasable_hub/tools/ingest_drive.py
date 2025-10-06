from __future__ import annotations

try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:  # pragma: no cover
    class Context:  # type: ignore
        pass


async def ingest_drive(folder_id: str, ctx: Context) -> dict:
    """Ingest files from Google Drive. Placeholder implementation.

    This stub expects service-layer integration with Google APIs which is not included
    in the base requirements. It returns success with the provided folder_id.
    """
    if not folder_id:
        return {"status": "error", "error": "folder_id is required"}
    # TODO: Implement Google Drive listing/download and pass to local ingestion
    return {"status": "success", "folder_id": folder_id}


def register(mcp):
    @mcp.tool()
    async def ingest_drive_tool(folder_id: str, ctx: Context) -> dict:
        return await ingest_drive(folder_id, ctx)


