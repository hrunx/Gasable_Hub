from typing import Dict, Any, Optional
from gasable_nodes.schema import NodeSpec
from gasable_nodes.exec_http import exec_openapi


async def run(params: Dict[str, Any], inputs: Dict[str, Any], creds: Optional[Dict[str, Any]], ctx):
    # Expect operationId from our sheets.json spec
    spec = NodeSpec(
        name="google_sheets.spreadsheets_values_get",
        version="1.0.0",
        title="Get values",
        category="Google Sheets",
        impl={  # type: ignore
            "type": "http",
            "openapi_provider": "sheets",
            "operation_id": "sheets.spreadsheets.values.get",
        },
    )
    return await exec_openapi(spec, params, inputs, creds, ctx)
