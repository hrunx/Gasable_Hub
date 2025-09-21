from mangum import Mangum
from webapp import app

# AWS Lambda entrypoint wrapping the existing FastAPI app
handler = Mangum(app)


