from setuptools import setup,find_packages
setup(
    name="anvil-app-server",
    version="1.0",
    packages=find_packages(),
    install_requires=["pychrome", "anvil-uplink==0.3.30", "progressbar2"],

    # Include the App Server JAR directly in this debug build of the package. That way the release version won't be downloaded on first run.
    package_data={
        "anvil_app_server": [
            "anvil-app-server.SNAPSHOT.jar", # BUILD:OMIT
            "TodoList.zip",
            "Default.zip",
            "Blank.zip"
        ] 
    },

    author="Anvil",
    author_email="contact@anvil.works",
    description="A standalone server for Anvil full-stack Python web apps",
    long_description="""
## A standalone server for Anvil full-stack Python web apps.

This package includes several assets, some not in Python:
 - The "anvil-standalone-runtime" script for launching the runtime
 - The "downlink" Python code for the server-side parts of apps
 - The core Anvil server (requires Java to launch)
 - The client-side Anvil runtime (Javascript, using the Skulpt Python-to-JS compiler)
    """,
    long_description_content_type="text/markdown",
    keywords="anvil web apps standalone browser Python",
    url="https://anvil.works",
    license="GNU Affero General Public License v3",
    project_urls={
        "Source Code": "https://github.com/anvil-works/anvil-runtime"
    },
    classifiers=[
        "License :: OSI Approved :: GNU Affero General Public License v3"
    ],
    entry_points = {
        "console_scripts": [
        "anvil-app-server=anvil_app_server:launch",
        # For compat with instructions given in preview
        "anvil-standalone-runtime=anvil_app_server:launch",
        "psql-anvil-app-server=anvil_app_server:psql",
        "create-anvil-app=anvil_app_server:create_app"
        ]
    })
