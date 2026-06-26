import importlib.resources
import os


def frontend_bundles():
    dist = os.path.join(os.path.dirname(__file__), 'frontend_dist')
    return [{
        'name': 'test_frontend_plugin',
        'display_name': 'Test Frontend Plugin',
        'dist_dir': dist,
        'entry': 'remoteEntry.js',
    }]
