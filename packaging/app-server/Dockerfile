FROM --platform=linux/amd64 rockylinux:9-minimal

# Need full-fat DNF to install .rpm files
RUN microdnf -y install dnf && \
    microdnf -y clean all && \
    dnf -y update && \
    dnf -y install wget ghostscript && \
    dnf -y clean all

RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm && \
    dnf -y install google-chrome-stable_current_x86_64.rpm && \
    dnf -y clean all && \
    rm google-chrome-stable_current_x86_64.rpm

RUN rpm --import https://yum.corretto.aws/corretto.key && \
    wget -O /etc/yum.repos.d/corretto.repo https://yum.corretto.aws/corretto.repo && \
    dnf -y install java-1.8.0-amazon-corretto-devel && \
    dnf -y clean all

RUN dnf -y install python3.11 python3.11-pip && \
    dnf -y clean all && \
    pip3.11 install --upgrade pip

ARG APP_SERVER_VERSION="anvil-app-server"
RUN pip install ${APP_SERVER_VERSION:-anvil-app-server}

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