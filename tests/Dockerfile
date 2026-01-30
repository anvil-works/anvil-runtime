FROM anvil-runtime-base:latest

# Database
COPY /runtime/database/ /runtime/database/
RUN cd /runtime/database/migrator-core && lein install

# Install server core
COPY /runtime/server/core/project.clj /runtime/server/core/project.clj
RUN cd /runtime/server/core && lein deps
COPY /runtime/server/core /runtime/server/core
RUN cd /runtime/server/core && lein install

# Build client
COPY /runtime/client /runtime/client
COPY tsconfig.json /tsconfig.json
COPY tsconfig.base.json /tsconfig.base.json
RUN cd /runtime/client && npm i && npm run build

# Get app server ready to be run
COPY /runtime/server/app-server /runtime/server/app-server
WORKDIR /runtime/server/app-server
RUN mkdir /anvil-data && lein deps

# Set up everything needed for downlink
COPY /runtime/services /runtime/services
COPY /runtime/downlink/python/ /runtime/downlink/python/
# anvil/_components.py is a symlink to doc/dist/_components.py (outside /runtime).
# Docker COPY preserves symlinks, so we must copy the target explicitly.
# Note: Other symlinks in downlink/python/anvil/ point to /runtime/services or
# /runtime/client which are copied above. Only _components.py points outside.
# The package build (build-python-package) uses 'cp -aL' to dereference symlinks.
COPY /doc/dist/_components.py /doc/dist/_components.py
RUN ~/.local/bin/uv pip install --system -r /runtime/downlink/python/requirements.txt
ENV PYTHON_INTERPRETER=/usr/bin/python3
ENV DOWNLINK_WORKDIR=/runtime/downlink/python

# Create non-root user (Postgres won't run as root)
RUN useradd -m anvil && \
    chown -R anvil:anvil /anvil-data /runtime && \
    cp -r /root/.m2 /home/anvil/.m2 && \
    cp -r /root/.lein /home/anvil/.lein && \
    chown -R anvil:anvil /home/anvil/.m2 /home/anvil/.lein
USER anvil
