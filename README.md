# Anvil Runtime and App Server

## Introduction

[Anvil](https://anvil.works) is a framework for building full-stack web apps with nothing but Python:

 * Your [browser-side code](https://anvil.works/python-browser) is in Python
 * Your [user interface](https://anvil.works/articles/python-gui-builder-web) is in Python
 * Your [server-side code](https://anvil.works/docs/server-code) is in Python
 * Your [database](https://anvil.works/docs/data-tables) is all Python objects

The Anvil Runtime is the open-source engine that powers those apps. This repository contains the Anvil Runtime libraries, as well as a standalone App Server which uses the Runtime to serve an Anvil app from the local filesystem.

## The Anvil Cloud Editor

The easiest way to build an Anvil app is the free online editor at https://anvil.works. It includes a [drag-and-drop GUI builder](https://anvil.works/articles/python-gui-builder-web) and [free, built-in hosting](https://anvil.works/docs/deployment) for your apps.

![A short animated clip of the Anvil editor](https://anvil-website-static.s3.eu-west-2.amazonaws.com/learn/tutorials/feedback-form/add-button.gif)

[![Try the Anvil Editor](https://anvil.works/img/github/try-editor.png)](https://anvil.works)

Nevertheless, you **don't need the cloud service at all** to build or run Anvil applications!

## Using the standalone App Server

This repository contains a standalone web server that serves a single Anvil app. Launching it is as simple as:

```bash
$ pip install anvil-app-server
$ create-anvil-app todo-list MyTodoList
$ anvil-app-server --app MyTodoList
```

For a step-by-step guide to running your first Anvil app, check out the [getting started guide](doc/getting-started.md). To learn how to create an Anvil app using your favourite Text Editor, check out [our guide](doc/creating-and-editing-apps.md).

## Features

* **Full-stack apps with nothing but Python** - The Anvil App Server runs your client-side code in the web browser, and the server-side code in server-side Python. It even has a built-in database, with rows that can be passed freely between server- and client-side code.

* **HTTPS out of the box** - If launched with an HTTPS origin, the Anvil App Server will launch an HTTPS reverse proxy and obtain a certificate from [Let's Encrypt](https://letsencrypt.org).

* **No configuration required** - The Anvil App Server includes its own database (Postgres) and reverse proxy (Traefik), so all you need to do is launch it. No need to spend half an hour setting up your environment.

* **Connect code from anywhere** - The Anvil [Uplink](https://anvil.works/docs/uplink) allows you to connect scripts, Jupyter notebooks, or anything else with a Python interpreter to your app.

* **Interactive shell** - Just launch the server with `--shell` to connect a fresh Python interpreter via the Uplink.


## How to write Anvil apps

You can find about Anvil apps at [https://anvil.works](https://anvil.works), where we also provide an online IDE, graphical UI designer, and an app hosting service - all available for free.

Check out the [step-by-step tutorials and examples](https://anvil.works/learn) and [reference documentation](https://anvil.works/docs).


## Advanced configuration

The standalone app server supports the following options:

```
      --config-file FILENAME                Load config from the specified YAML file
      --data-dir DIRECTORY                  Store data in the specified directory (default: .anvil-data)
      --auto-migrate                        Migrate data tables schema automatically
      --ignore-invalid-schema               Ignore invalid data tables schema and run anyway
      --database DB-URL                     Database URL
      --app DIRECTORY                       Load and run the specified app
      --dep-id ID=PACKAGE                   Associate a dependency app ID with its package name
      --secret NAME=VALUE                   Provide an app secret
      --encryption-key NAME=VALUE           Pass an app encryption key
      --downlink-key KEY                    Authentication key for a separately launched downlink
      --uplink-key KEY                      Key to connect server (privileged) uplinks to this app
      --client-uplink-key KEY               Key to connect client (unprivileged) uplinks to this app
      --shell                               Launch an interactive Python shell for your app (via the uplink)
      --ip IP                               Listen on the specified IP address
      --port PORT                           Serve HTTP requests on the specified port
      --http-redirect-port PORT             Redirect HTTP requests on the specified port to HTTPS
      --smtp-server-port PORT               Accept SMTP email on the specified port
      --origin URL                          Set the home URL of this app (eg https://my-app.com)
      --disable-tls                         Don't terminate TLS connections, regardless of the origin scheme
      --forward-headers-insecure            When running embedded TLS termination, pass through the X-Forwarded-* headers (off by default)
      --add-hsts-headers                    Enable HSTS headers when origin URL uses https. Default: false
      --letsencrypt-storage PATH            Path to a JSON file to store LetsEncrypt certificates
                                            (default: <data-dir>/letsencrypt-certs.json)
      --letsencrypt-staging                 Use the LetsEncrypt staging server
      --manual-cert-file PATH               Path to an external TLS certificate in PEM format
      --manual-cert-key-file PATH           Path to an external TLS certficate private key file in PEM format
      --smtp-host HOST                      Hostname of SMTP server to use for sending email
      --smtp-port PORT                      Port to connect to on SMTP server
      --smtp-encryption                     Use TLS to connect to SMTP server
      --smtp-username USER                  Username to authenticate with on SMTP server
      --smtp-password PASSWORD              Password to authenticate with on SMTP server
      --google-client-id CLIENT_ID          Client ID to use for Google authentication
      --google-client-secret CLIENT_SECRET  Client secret to use for Google authentication
      --google-api-key KEY                  API key to use for Google integration
      --google-refresh-token TOKEN          Refresh token to use for delegated Google access (eg App Files)
      --facebook-app-id APP_ID              App ID to use for Facebook authentication
      --facebook-app-secret APP_SECRET      App secret to use for Facebook authentication
      --microsoft-app-id APP_ID             App ID to use for Microsoft authentication
      --microsoft-app-secret APP_SECRET     App secret to use for Microsoft authentication
      --microsoft-tenant-id TENANT_ID       Tenant ID to use for Microsoft authentication
```

In turn:

### General configuration

#### config-file

All configuration options can be supplied from a YAML file of keys and values instead of the command line. The key names in this YAML file are the same as the command-line options (without the leading dashes). Options that take multiple key-value pairs (eg `--secret`) are specified as key-value maps. "Bare" options (which take no arguments) are specified as `true` or `false`. All other options are specified as strings.

Here is an example config file that configures the App Server to use an existing database and specifies some app secrets:

```
database: "jdbc:postgresql://localhost/my_database?username=alice&password=mypassword"
secret:
  api_key: "iepaicu6aeSu3Voa1Phe"
  admin_password: "sheiGei9xq"
```

#### data-dir

The App Server stores local data in a data directory (this includes secret keys for the capability system, error logs, and the bundled Postgres installation if enabled). By default, this directory is `./.anvil-data`; this option configures it to point somewhere else. The directory will be created if it does not already exist.

If you are running multiple apps using the built-in database, each app should have a separate `data-dir`.

#### auto-migrate

Anvil applications contain a description, in the [`anvil.yaml` file](doc/app-structure.md), of the [Data Tables](https://anvil.works/docs/data-tables) schema they expect. On first startup with an empty database, the App Server will set up that schema for you.

If the database is already configured with a different schema, the App Server will (by default) print a message describing the transformation that would be required to make the database match the schema the app is expecting. If you launch with `auto-migrate` enabled, those changes will be applied. **This may be destructive to the data in your database.**

#### ignore-invalid-schema

If the database is configured with a different schema to what this app is expecting, the App Server will (by default) print a message and exit. If you launch with `ignore-invalid-schema` enabled, it will load the app anyway. **This may cause runtime errors as your app attempts to access tables or columns that do not exist.**

#### database

The Anvil Runtime stores most of its data in a Postgres database. By default, the App Server uses a bundled Postgres database, storing its data in the `data-dir` (`./.anvil-data` by default).

If you want to use an existing database, specify its JDBC URI as the `database` option. Here is an example:

```
"jdbc:postgresql://localhost/my_database?username=alice&password=mypassword"
```

The user specified in this URI must have permissions to create tables within this database. The first time the App Server launches, it will create all the tables it needs.

Each Anvil app you run should have a separate database within your Postgres installation.

#### app

The directory in which the main app is checked out. The App Server will look for any [dependencies](https://anvil.works/docs/deployment/dependencies) in the parent of this directory -- that is to say, any dependency apps should be checked out into adjacent directories to this one.

By default, the app server looks for an Anvil app in the current directory ("`.`").

#### dep-id

If an application uses other apps as [dependencies](https://anvil.works/docs/deployment/dependencies), it will refer to these apps with opaque identifiers. This option allows you to specify the name of the directory containing the dependency. The App Server looks for dependencies in the _parent directory_ of the app (that is, dependency apps should be checked out _next to_ the main app directory, not inside it).

You can specify multiple dependencies on the command line with multiple `--dep-id` flags:

```
--dep-id MAGTM7NPDRPPUAWY=MyLibrary --dep-id LUBRMCXK3R4FTTH3=CustomComponent1
```
or in a YAML `config-file`:
```
dep-id:
  "MAGTM7NPDRPPUAWY": "MyLibrary"
  "LUBRMCXK3R4FTTH3": "CustomComponent1"
```

#### secret

Anvil supports [App Secrets](https://anvil.works/docs/security/encrypting-secret-data), which allow you to avoid putting secrets (such as passwords or API keys) into your source code. This option specifies the value of a particular secret.

You can specify multiple secrets on the command line with multiple `--secret` flags:

```
--secret database_password=letmein --secret twilio_api_key=1234
```
or in a YAML `config-file`:
```
secret:
  database_password: "letmein"
  twilio_api_key: "1234"
```

#### encryption-key

A [Secrets Service](https://anvil.works/docs/security/encrypting-secret-data) encryption key (for use with `anvil.secrets.encrypt_with_key()`) is a base64-encoded AES128 key. You can use the `encryption-key` option the same way as `secret`.

#### downlink-key

By default, the App Server launches its own downlink. If you want to provide a separate downlink, make up a (long, secure, random) token and specify it as the `downlink-key`. Then launch the downlink separately with:

```
$ export DOWNLINK_SERVER=ws://your-runtime-server:3030/_/downlink
$ export DOWNLINK_KEY="[your_key_here]"
$ python -m anvil_downlink_host.run
```

Specifying a `downlink-key` will prevent the App Server from launching a downlink.


#### uplink-key

If you want to connect [Uplink](https://anvil.works/docs/uplink) code to this App Server, generate a (long, secure, random) token and specify it as the `uplink-key`. Then, in your Uplink code, connect with:

```python
anvil.server.connect("[uplink-key goes here]", url="ws://your-runtime-server:3030/_/uplink")
```

If you are serving your app over HTTPS, the url should begin with `wss://`. For example:

```python
anvil.server.connect("[uplink-key goes here]", url="wss://your-runtime-server.com/_/uplink")
```

#### client-uplink-key

If you want to connect **unprivileged**, aka client, Uplink code, use this key instead. This option works the same way as `uplink-key`.

#### shell

If this option is set, the App Server will launch an interactive Python shell and connect it to your app via the Uplink. This means you can, for example, access the App Tables and Users service from this shell. You can also import code from your app and its dependencies (specifically, the interpreter has `app-dir`'s parent directory on its `PYTHONPATH`).

If the built-in Python shell isn't sufficient, you can connect any interactive environment (eg a Jupyter notebook) to your app by setting the `uplink-key` option (see above).

#### ip

Listen on the specified IP address. (Default: `0.0.0.0`, listens on all interfaces)

#### port

Listen on the specified port for HTTP requests. (Default: `3030`, or as inferred from `origin`)

#### smtp-server-port

Listen on the specified port for inbound SMTP, so your application can [receive email](https://anvil.works/docs/email). (Default: `25`, or if binding to that address fails, `2525`.)

### URLs and HTTPS

#### origin

The Anvil runtime needs to know the URLs it's serving, so it can generate URLs that point to itself. By default, it uses `http://localhost:<port>/`, but if your application is hosted on a public host, you'll need to tell it what hostname to use.

If you specify an `https` origin, by default the Anvil runtime will serve this app over HTTPS (using a embedded reverse proxy, [Traefik](https://traefik.io)), and attempt to get a certificate from [Let's Encrypt](https://letsencrypt.org). The `ip` and `port` options will be interpreted as referring to this HTTPS server.

If you want to supply your own TLS certificates, see the `manual-cert-file` option. If you want to run your own TLS reverse proxy, use the `disable-tls` option.

#### disable-tls

If this option is specified, the Anvil app server will not run a TLS server, even if an HTTPS `origin` is provided. It will open an HTTP server as controlled by the `ip` and `port` options.

#### forward-headers-insecure

When running embedded TLS termination, trust incoming `X-Forwarded-*` headers and forward them to the Anvil App Server. You should only enable this option when running behind a trusted reverse proxy which sets these headers.

#### letsencrypt-storage

Let's Encrypt has stringent rate limits, so it is important to store the key and certificate material, and re-use it wherever possible. By default, this is stored in the `data-dir`, as a file called `letsencrypt-certs.json`, but if you want to store it elsewhere (for example, to use the same set of certificates for multiple Anvil apps with separate data directories), specify the file to use here.

#### letsencrypt-staging

Let's Encrypt has stringent rate limits, so if you're testing, you should use their staging service (which generates invalid certificates but has no rate limits). This option causes Anvil to use Let's Encrypt's staging service.


#### manual-cert-file

If you are using the Anvil app server's built-in HTTPS termination, but providing your own TLS certificates, specify a path to your certificate here (in PEM format). You should also specify `manual-cert-key-file`.

#### manual-cert-key-file

If you are using the Anvil app server's built-in HTTPS termination, but providing your own TLS certificates, specify a path to your private key here (in PEM format). You should also specify `manual-cert-key-file`.

### Accessing the database

The Anvil Runtime stores most of its data in a Postgres database. By default, the App Server uses a bundled Postgres database, storing its data in the `data-dir` (`./.anvil-data` by default).

You can access this database directly with the command `psql-anvil-app-server <data-dir>`:

**Note:** You will need the `psql` or `pgcli` command-line client installed. On Debian-like Linux systems, run `apt-get install postgresql-client`; on a Mac, run `brew install postgresql`.

1. Run your app using the `anvil-app-server --app <directory-name>` command
2. In a new terminal, run `psql-anvil-app-server` in the same directory as you started `anvil-app-server`. You can also specify a `data-dir`, which should match the `--data-dir` option passed to `anvil-app-server` (if applicable). For example, if you launched your app using `anvil-app-server --app MyApp --data-dir my-data-dir`, you would access the pgcli shell using `psql-anvil-app-server my-data-dir`.

You can also access the database shell using the port and password, which you can find in the `<data-dir>` directory:

* User: postgres
* Port: stored in `<data-dir>/db/postmaster.opts`
* Password: stored in `<data-dir>/postgres.password`

This means you can run `psql -h localhost -p <port> -U postgres` to access the psql shell directly, or connect other graphical tools to it.

When you connect with `psql-anvil-app-server`, the database shell will use the `app_tables` schema, allowing you to access your Data Tables like ordinary Postgres tables.

### Sending email

#### smtp-host

In order for your app to send email (using the [Email Service](https://anvil.works/docs/email), or signup confirmations for the [Users Service](https://anvil.works/docs/users)), you need to specify connection details for an SMTP server. This is the hostname to connect to.

#### smtp-port

Port for outbound SMTP server (see `smtp-host`).

#### smtp-encryption

Enable TLS for connecting to outbound SMTP server (see `smtp-host`). Takes "starttls" or "ssl" as a string value.

#### smtp-username

Username for authenticating with outbound SMTP server (see `smtp-host`).

#### smtp-password

Password for authenticating with outbound SMTP server (see `smtp-host`).

### Service Integrations and API keys

#### google-client-id

If your app uses Anvil's [Google Service](https://anvil.works/docs/integrations/google), for login or anything else, you will need a client ID for Google's API. Specify it with this option.

#### google-client-secret

If your app uses Anvil's [Google Service](https://anvil.works/docs/integrations/google), for login or anything else, you will need a client secret for Google's API. Specify it with this option.

#### google-refresh-token

If your app uses [App Files](https://anvil.works/docs/integrations/google/google-drive#drive-app-files) from Anvil's [Google Service](https://anvil.works/docs/integrations/google), it needs credentials to access those App Files -- specifically, a Refresh Token (corresponding to the Google OAuth Client ID and Secret) with access to your app's App Files.


#### facebook-app-id

If your app uses Anvil's [Facebook Service](https://anvil.works/docs/integrations/facebook), for login or anything else, you will need an app ID for Facebook's API. Specify it with this option.

#### facebook-app-secret

If your app uses Anvil's [Facebook Service](https://anvil.works/docs/integrations/facebook), for login or anything else, you will need an app secret for Facebook's API. Specify it with this option.

#### microsoft-app-id

If your app uses Anvil's [Microsoft Service](https://anvil.works/docs/integrations/microsoft), for login or anything else, you will need an app ID for Microsoft's API. Specify it with this option.

#### microsoft-app-secret

If your app uses Anvil's [Microsoft Service](https://anvil.works/docs/integrations/microsoft), for login or anything else, you will need an app secret for Microsoft's API. Specify it with this option.

#### microsoft-tenant-id

If your app uses Anvil's [Microsoft Service](https://anvil.works/docs/integrations/microsoft), for login or anything else, you may wish to restrict all logins to one Azure AD tenant. Specify it with this option.


## Troubleshooting and other notes

### Startup behaviour and code download

The App Server contains an HTTP server component that runs on the JVM, and is not downloaded as part of the `pip install` (it's too large for PyPI's index). Instead, the App Server will download a JAR file from the server on first launch. It will attempt to store this file in the package directory (if it is writable), or into the `.anvil` folder in your home directory.

### Mac OS certificate issues

Some Python versions may encounter certificate issues downloading this file, because Python packages bundle their own root certificates (and may therefore be out of date). See [this StackOverflow question](https://stackoverflow.com/questions/40684543/how-to-make-python-use-ca-certificates-from-mac-os-truststore) for a solution.

---

## Architecture

The Anvil Runtime consists of three components:

1. The **server** loads the app from the filesystem, serves HTTP requests, and manages the downlink. The server is written in Clojure and runs on the JVM.

   This repository contains the core runtime engine, plus a standalone server that uses that engine to serve a single app.


2. The **client code**, which runs the app's client side code in the web browser (using the [Skulpt](http://skulpt.org) Python-to-Javascript compiler). It provides a Python [user interface toolkit](https://anvil.works/docs/client) to make it easy to build graphical UIs.


3. The **downlink**, which runs the app's [Server Modules](https://anvil.works/docs/server).


All three components are installed when you `pip install anvil-app-server`, and you will need Java installed in order to launch the App Server.


## Developing and Contributing to this project

For instructions on building and editing this code, check out [doc/HACKING.md](doc/HACKING.md).


## Licence

The Anvil Runtime and App Server are made available under the GNU Affero General Public Licence (AGPL). You can download it and use it freely, but if you modify the Runtime or App Server code you must make the source code of your modifications available to everyone who uses it (even over a network).

**You do not have to make your Anvil apps open source.** We have added an exception to the licence that gives you explicit permission to use this code to host non-open-source applications, and to distribute it alongside them.
