from setuptools import setup, find_packages

setup(
    name="flyte-tasks",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "flytekit",
        "libaarhusxyz",
        "msgpack-numpy",
        "numpy",
        "scipy",
        "fsspec",
        "requests",
    ],
    python_requires=">=3.11",
    description="Nagelfluh Flyte task implementations",
    author="Nagelfluh Team",
)
