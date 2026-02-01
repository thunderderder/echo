import json
import os
from dotenv import load_dotenv
import httpx

load_dotenv()
token = os.getenv("OPENAI_API_KEY")

# Check deployment status
response = httpx.get(
    "https://space.ai-builders.com/backend/v1/deployments/echo/logs?log_type=runtime&timeout=10",
    headers={"Authorization": f"Bearer {token}"}
)

print(f"Status: {response.status_code}")
result = response.json()
print(f"\nLogs:\n{result.get('logs', 'No logs')}")
