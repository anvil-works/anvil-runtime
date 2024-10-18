FROM --platform=linux/amd64 rockylinux:9-minimal

# Need full-fat DNF to install .rpm files
RUN microdnf -y install dnf && \
    dnf -y update && \
    dnf -y install wget ghostscript

RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm && \
    dnf -y install google-chrome-stable_current_x86_64.rpm && \
    rm google-chrome-stable_current_x86_64.rpm

RUN rpm --import https://yum.corretto.aws/corretto.key && \
    wget -O /etc/yum.repos.d/corretto.repo https://yum.corretto.aws/corretto.repo && \
    dnf -y install java-1.8.0-amazon-corretto-devel

RUN dnf -y install python3.11 python3.11-pip && \
    pip3.11 install --no-cache --upgrade pip

ARG APP_SERVER_VERSION="anvil-app-server"
RUN pip install --no-cache ${APP_SERVER_VERSION}

# Download the app server JAR
RUN anvil-app-server || true

# This package trips vulnerability scanners but is only needed for installation
RUN dnf -y remove python3.11-pip

RUN mkdir /apps
WORKDIR /apps

RUN mkdir /anvil-data

RUN useradd anvil
RUN chown -R anvil:anvil /anvil-data
USER anvil

ENTRYPOINT ["anvil-app-server", "--data-dir", "/anvil-data"]

CMD ["--app", "MainApp"]