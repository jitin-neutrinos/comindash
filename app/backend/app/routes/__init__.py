"""API routers."""

from app.routes import (
    admin,
    auth,
    exports,
    health,
    insights,
    overview,
    pain_points,
    pipeline,
    posts,
    relationships,
    review,
    topics,
    trends,
)

ALL_ROUTERS = [
    auth.router,
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
    review.router,
    exports.router,
]
