"""Setup script for magnetic survey process types."""

from setuptools import setup, find_packages

setup(
    name="mag-processes",
    version="0.1.0",
    description="Magnetic survey process type implementations for Nagelfluh",
    packages=find_packages(),
    install_requires=[
        "AirMagTools @ git+https://github.com/SagebrushGeoTools/AirMagTools.git",
        "fsspec",
        "s3fs",
        "gcsfs",
        "swaggerspect>=0.1.5",
    ],
    entry_points={
        "nagelfluh.process_types": [
            "import_mag=mag_processes.import_process:MagCSVImporter",
            "process_mag=mag_processes.processing_process:MagProcessing",
        ],
    },
)
