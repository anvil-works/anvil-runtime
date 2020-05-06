FROM ubuntu:18.04

# This replicates a bug in OpenJDK 11. If you install openjdk-8-jdk, it will work
RUN apt-get -yyy update && apt-get -yyy install openjdk-11-jdk python python-pip

COPY python-package-build /anvil-app-server-bin

RUN pip install /anvil-app-server-bin

VOLUME /apps

WORKDIR /apps

ENV APP=MainApplication

RUN useradd anvil

USER anvil

CMD ["bash", "-c", "anvil-app-server --app $APP"]

# To run:
# mkdir ~/tmp/anvil-apps/.anvil-data
# chown -R 1000 ~/tmp/anvil-apps/.anvil-data
# docker run --rm -v ~/tmp/anvil-apps:/apps -e APP=Feedbackform container-name