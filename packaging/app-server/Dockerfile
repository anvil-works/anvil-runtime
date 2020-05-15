FROM python:3

RUN apt-get -yyy update && apt-get -yyy install software-properties-common && \
    wget -O- https://apt.corretto.aws/corretto.key | apt-key add - && \
    add-apt-repository 'deb https://apt.corretto.aws stable main'

RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    (dpkg -i google-chrome-stable_current_amd64.deb || apt install -y --fix-broken) && \
    rm google-chrome-stable_current_amd64.deb 


RUN apt-get -yyy update && apt-get -yyy install java-1.8.0-amazon-corretto-jdk ghostscript

RUN pip install anvil-app-server
RUN anvil-app-server || true

VOLUME /apps
WORKDIR /apps

RUN mkdir /anvil-data

RUN useradd anvil
RUN chown -R anvil:anvil /anvil-data
USER anvil

ENTRYPOINT ["anvil-app-server", "--data-dir", "/anvil-data"]

CMD ["--app", "MainApp"]