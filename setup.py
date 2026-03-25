from setuptools import setup, find_packages

setup(
    name="stitcher-proxy",
    version="0.1.0",
    description="Universal, infinite-memory proxy for LLM APIs.",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Nicolai",
    license="MIT",
    packages=find_packages(),
    python_requires=">=3.11",
    install_requires=[
        "fastapi>=0.111.0",
        "uvicorn>=0.30.1",
        "httpx>=0.27.0"
    ],
    entry_points={
        "console_scripts": [
            "stitcher-proxy=stitcher_proxy.__main__:main",
        ],
    },
)
