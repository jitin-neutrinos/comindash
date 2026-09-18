"""API routers."""

from app.routes import (
    admin,
    exports,
    health,
    insights,
    overview,
    pain_points,
    pipeline,
    posts,
    relationships,
    topics,
    trends,
)

ALL_ROUTERS = [
    admin.router,
    health.router,
    overview.router,
    pain_points.router,
    insights.router,
    trends.router,
    topics.router,
    posts.router,
    relationships.router,
    pipeline.router,
    exports.router,
]
