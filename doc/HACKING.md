# Developing the Anvil Runtime and App Server

## Overview

The Runtime and App Server are split up into a few modules. Broadly, client code is in Javascript; server code is in Clojure; and downlink code is in Python.

* The `client/` directory contains client-side code, written in Javascript and HTML. We depend on a few libraries, with particular emphasis on the [Skulpt](https://skulpt.org) Python-to-Javascript compiler.

* The `database/` directory contains schemas for the Postgres database, including a Clojure library for performing migrations and database setup.

* The `downlink/` directory contains the code that runs your apps' server-side Python code.

* The `packaging/` directory contains scripts for building the App Server as a standalone package.

* The `services/` directory contains Javascript and Python source code for Anvil's "Services", add-in components that provide 

* The `server/` directory contains the server-side Clojure code. This is split into two projects:

  * `server/core/` is the Anvil Runtime library, which is used both by the standalone App Server and by the (non-open-source) Anvil hosted platform which can be found at [anvil.works](https://anvil.works)

  * `server/app-server/` is the Anvil App Server, a standalone server that uses the Runtime library to serve a single Anvil app from the local filesystem.


## Build Instructions

### Prerequisites

To build the standalone runtime, you will need [Leiningen](https://leiningen.org) and [NPM](https://npmjs.com)/Node.

You will also need to (locally) install the `embedded-traefik` library. Do this in a separate directory from the Anvil source code:

```bash
$ git clone git@github.com:anvil-works/embedded-traefik.git
$ cd embedded-traefik/
$ lein install
```

### Building

First, build the client component:

```bash
$ cd client/
$ npm install
$ npm run build
```

Next, build the server components and produce a Python package ready for distribution:

```bash
$ cd ../packaging/app-server
$ ./build-all
```

And now you can install the app-server:
```bash
pip install /anvil/runtime/packaging/app-server/python-package-build
```

## Building and Running for Development

If you are doing development, then building the entire system every time is not ideal. You'll want to set up each component so it is easy to rebuild and restart. First, perform all the build steps above. Then:

Start a live rebuilder for the client-side components:

```bash
$ cd client/
$ npm run watch
```

On the server side, you can set up a sample configuration file, and start the standalone App Server as a lein REPL:

```bash
$ cd server/standalone
$ mkdir test-files/
$ cp anvil.conf.yaml.SAMPLE test-files/anvil.conf.yaml
$ lein run repl
```


Finally, you can run the Downlink (we recommend setting up a Python virtual environment rather than installing its dependencies globally):

```bash
$ . ~/some/virtualenv/bin/activate
$ cd downlink/python/
$ pip install -r requirements.txt
$ export DOWNLINK_SERVER=ws://localhost:3030/_/downlink
$ python -m anvil_downlink_host.run
```

### Tooling

You don't have to do all your development from the command line, of course!

We personally use and recommend the IntelliJ suite of IDEs: we use the [Cursive](https://cursive-ide.com/) plugin for our Clojure code, [PyCharm](https://www.jetbrains.com/pycharm/) for Python dvelopment, and [WebStorm](https://www.jetbrains.com/webstorm/) for front-end development.


## Contributing

We welcome community contributions to the Anvil Runtime and App Server! Please submit Pull Requests and file issues at [github.com/anvil-works/anvil-runtime](https://github.com/anvil-works/anvil-runtime).

In order to contribute code to this repository, you will need to sign a Contributor Licence Agreement (CLA). You can view and sign it here:

[**https://anvil-runtime-cla.anvil.app**](https://anvil-runtime-cla.anvil.app)


*About our CLA:* Our CLA is the standard "HA-CAA-[I/E]-ANY" agreement from the [Harmony Project](http://harmonyagreements.org), a CLA standardisation effort started by Canonical, makers of Ubuntu. The CLA absolves you of liability for the contents of your contributions, and assigns us rights to distribute any contributions as part of our commercial offerings, including an assignment of copyright, accompanied by a wide grant-back of rights so that you can still use your contribution for anything else.
