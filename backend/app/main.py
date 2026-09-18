from fastapi import FastAPI
from mangum import Mangum

from app.events.routes import router as events_router
from app.feed.routes import router as feed_router
from app.media.routes import router as media_router
from app.notifications.routes import router as notifications_router
from app.posts.routes import router as posts_router
from app.search.routes import router as search_router
from app.users.routes import router as users_router

app = FastAPI(title="fanwire")

app.include_router(events_router)
app.include_router(users_router)
app.include_router(media_router)
app.include_router(posts_router)
app.include_router(notifications_router)
app.include_router(feed_router)
app.include_router(search_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


handler = Mangum(app)
