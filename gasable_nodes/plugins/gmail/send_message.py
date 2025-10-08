from typing import Dict, Any, Optional
from gasable_nodes.schema import NodeSpec
from gasable_nodes.exec_http import exec_openapi


async def run(params: Dict[str, Any], inputs: Dict[str, Any], creds: Optional[Dict[str, Any]], ctx):
    spec = NodeSpec(
        name="gmail.messages_send",
        version="1.0.0",
        title="Send message",
        category="Gmail",
        impl={  # type: ignore
            "type": "http",
            "openapi_provider": "gmail",
            "operation_id": "gmail.users.messages.send",
        },
    )
    return await exec_openapi(spec, params, inputs, creds, ctx)
