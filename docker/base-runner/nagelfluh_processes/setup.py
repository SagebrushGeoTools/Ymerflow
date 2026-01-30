"""Setup script for Nagelfluh process types."""

from setuptools import setup, find_packages

setup(
    name="nagelfluh-processes",
    version="0.1.0",
    description="Process type implementations for Nagelfluh",
    packages=find_packages(),
    install_requires=[
        "fsspec",
        "s3fs",
        "gcsfs",
        "requests",
        "libaarhusxyz",
        "pandas",
        "projnames",
        "msgpack",
        "msgpack-numpy",
        "geopandas",
    ],
    entry_points={
        "nagelfluh.process_types": [
            "fft=nagelfluh_processes.fake_processes:fft",
            "inversion=nagelfluh_processes.fake_processes:inversion",
            "import_data=nagelfluh_processes.fake_processes:import_data",
            "create_environment=nagelfluh_processes.fake_processes:create_environment",
        ],
    },
)
