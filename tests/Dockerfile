FROM --platform=linux/amd64 ubuntu:22.04

RUN apt update && apt install -y curl java-common wget python3 python3-pip git 
RUN pip install pytest
RUN pip install anvil-uplink
RUN pip install pyyaml

# install java 
RUN wget https://corretto.aws/downloads/latest/amazon-corretto-22-x64-linux-jdk.deb && \
    dpkg -i amazon-corretto-22-x64-linux-jdk.deb && \
    rm amazon-corretto-22-x64-linux-jdk.deb 

# lein setup
RUN curl -O https://raw.githubusercontent.com/technomancy/leiningen/stable/bin/lein && \
    chmod +x lein && \
    mv lein /usr/local/bin/ && \
    lein

# Nodejs
RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs

#  embedded-traefik
RUN git clone https://github.com/anvil-works/embedded-traefik.git && \
    cd embedded-traefik/ && \
    lein install 

# Database
COPY /runtime/database/ /runtime/database/
RUN cd /runtime/database/migrator-core && \
    lein install    

# Install server core
COPY /runtime/server/core/project.clj /runtime/server/core/project.clj
RUN cd /runtime/server/core && \
    lein deps
COPY /runtime/server/core /runtime/server/core
RUN cd /runtime/server/core && \
    lein install

# Build client
COPY /runtime/client /runtime/client
COPY tsconfig.json /tsconfig.json
COPY tsconfig.base.json /tsconfig.base.json
RUN cd /runtime/client && \
    npm i && \  
    npm run build

# Get app server ready to be run
COPY /runtime/server/app-server /runtime/server/app-server
WORKDIR /runtime/server/app-server
RUN mkdir /anvil-data
RUN lein deps

# Set up everythin needed for downlink
COPY /runtime/services /runtime/services
COPY /runtime/downlink/python/ /runtime/downlink/python/
RUN pip install -r /runtime/downlink/python/requirements.txt
RUN pip install pychrome
ENV PYTHON_INTERPRETER=/usr/bin/python3
ENV DOWNLINK_WORKDIR=/runtime/downlink/python
