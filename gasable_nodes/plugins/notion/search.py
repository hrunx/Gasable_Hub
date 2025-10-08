from typing import Dict, Any, Optional
from gasable_nodes.schema import NodeSpec
from gasable_nodes.exec_http import exec_openapi


async def run(params: Dict[str, Any], inputs: Dict[str, Any], creds: Optional[Dict[str, Any]], ctx):
    spec = NodeSpec(
        name="notion.search",
        version="1.0.0",
        title="Search",
        category="Notion",
        impl={  # type: ignore
            "type": "http",
            "openapi_provider": "notion",
            "operation_id": "notion.search",
        },
    )
    return await exec_openapi(spec, params, inputs, creds, ctx)


