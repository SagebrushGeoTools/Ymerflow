import os

_request_count = 0


def register_routers(app):
    from fastapi import APIRouter

    router = APIRouter(prefix='/test-backend-plugin', tags=['test-backend-plugin'])

    @router.get('/hello')
    def hello():
        global _request_count
        _request_count += 1
        return {
            'message': 'Hello from the backend plugin!',
            'count': _request_count,
        }

    app.include_router(router)
    return []


def frontend_bundles():
    dist = os.path.join(os.path.dirname(__file__), 'frontend_dist')
    return [{
        'name': 'test_backend_plugin',
        'display_name': 'Test Backend Plugin',
        'dist_dir': dist,
        'entry': 'remoteEntry.js',
    }]
