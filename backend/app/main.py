from fastapi import FastAPI
from mangum import Mangum

app = FastAPI(title="fanwire")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


handler = Mangum(app)
