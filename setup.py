from setuptools import setup, find_packages

setup(
    name='nagelfluh',
    version='0.1.0',
    packages=['billing'] + find_packages(include=['billing', 'billing.*']),
    install_requires=[
        # The frontend-plugin build harness now lives in its own repo (ymerflow-plugin-sdk).
        # Depend on it via git URL so nothing relies on a local deps/ checkout.
        "ymerflow-plugin-build @ git+https://github.com/SagebrushGeoTools/Ymerflow-plugin-sdk.git",
    ],
    entry_points={
        'nagelfluh.hooks': [
            'register_models    = billing:register_models',
            'register_routers   = billing:register_routers',
            'frontend_bundles   = billing:frontend_bundles',
            'user_query_options = billing:user_query_options',
            'user_to_dict       = billing:user_to_dict',
            'job_pre_run        = billing:job_pre_run',
            'job_completed      = billing:job_completed',
            'user_created       = billing:user_created',
        ],
    },
)
