# Running Anvil apps locally

You can export any Anvil app from the Anvil Editor and run it on your computer using the open-source [Anvil App Server](https://github.com/anvil-works/anvil-runtime). 

You can also **build and deploy your apps in Anvil's cloud** -- by far the easiest way to build a web app. Build your app using our [online IDE](https://anvil.works), complete with drag-and-drop UI designer and autocomplete -- then [click one button](https://anvil.works/docs/deployment), and it's live on the web!

Follow this how-to guide to export an Anvil app from the online IDE and run it on your own machine.

All you need to do to run your app locally is:

1. Install the Anvil App Server
2. [Clone an Anvil app onto your local machine with git](https://anvil.works/docs/version-control/git)
3. Launch your app

## Set up your environment

### Dependencies

You will need to install the **Java virtual machine** and the Postgres libraries. On Debian-based Linux systems (like Ubuntu and Raspbian), you can do:

```bash
$ sudo apt-get install openjdk-8-jdk libpq-dev
```

On a Mac, you can use Homebrew:
```bash
$ brew install openjdk pgcli
```

On Windows systems, you can install [Amazon Corretto](https://aws.amazon.com/corretto/). Any version is OK (Java 8 minimum).

To enable [PDF rendering support](https://anvil.works/docs/working-with-files/creating-pdf-files) (Linux only), you will need both Chrome and Ghostscript installed. On Debian-based systems, you can do:

```bash
$ wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
$ sudo dpkg -i google-chrome-stable_current_amd64.deb
$ sudo apt-get install ghostscript
```


### Installing the runtime

The easiest way to install the Anvil runtime is via `pip`. We suggest you do this inside a [virtual environment](https://docs.python.org/3/library/venv.html).

You can create and activate a virtual environment by running these commands in your terminal:

```bash
# Create your "env" virtual environment
$ python3 -m venv env
# Activate your "env" virtual environment
$ . env/bin/activate
```

The Anvil app server is available [on PyPI](https://pypi.org/project/anvil-app-server), so you can install it with `pip`:

```bash
# Install the standalone runtime
$ pip install anvil-app-server
```

<!--{{<notice alert>}}-->
If you want to use additional Python [packages](https://anvil.works/docs/server/packages) (e.g. numpy, pandas) in your app's server-side code, you should make sure these are installed too!
<!--{{</notice>}}-->

## Clone your app with git

Next, clone the Anvil app you want to run locally onto your machine. 

Each Anvil app is represented by a Git repository. If you click the **Clone with Git** button in the [Version History dialog](https://anvil.works/docs/version-control), you'll see the command to clone the app onto your own machine:

<!-- {{<figure src="img/git-clone.png" alt="The Clone With Git dialog, with a box to copy your SSH public key into." narrow="true">}}
 -->
Paste the command into a terminal window to clone your app onto your machine. It will look something like this:

```bash
# Clone your Anvil app onto your machine
$ git clone ssh://bridget%40anvil.works@anvil.works:2222/RJYQKQBMRN2JJF6U.git MyApp
```

When cloned, the Git repository will be placed in a directory named using the app's package name. For example, the example above would clone the app into a directory named 'MyApp'.

## Start the web server

You can now run your app locally with this command:

`anvil-app-server --app <app-directory-name>`

where `<app-directory-name>` is the name of the directory created in the step above. For example:

```bash
# Run the app we downloaded into the 'MyApp' directory
$ anvil-app-server --app MyApp
```

This will start a web server. Navigate to [`http://localhost:3030/`](http://localhost:3030/) and you'll see your app running!

### Live updates

You can simply refresh your browser to see changes you make locally - there's no need to restart the web server!

## Making it accessible to other people

### Make it accessible on your local network

The commands we've just given only make your app available on `localhost` -- that is, from your local machine. If your computer can be reached elsewhere on the network, or on the internet, you can specify your computer's hostname with the `--origin` flag:

```bash
$ anvil-app-server --app MyApp --origin http://my-host:8080
```

(Substitute `my-host` with the hostname or IP address of the computer you're serving from.)


### Make it accessible over HTTPS

The command above will expose your service _unencrypted_, which is dangerous on the public internet. Public services should always be served over HTTPS. Anvil has built-in integration with [Let's Encrypt](https://letsencrypt.org), so if your computer is accessible on port 443 on the public internet, you can specify an `https://` origin, and Anvil will take care of the rest:

```bash
$ anvil-app-server --app MyApp --origin https://my-host.example.com
```

Note that, on many Linux systems, this will not work, because unprivileged users cannot create services on port 443. This is a somewhat archaic restriction, and there are a few ways around it. The simplest is to turn it off, with the commands:

```bash
$ sudo su
\# echo 'net.ipv4.ip_unprivileged_port_start=0' > /etc/sysctl.d/50-unprivileged-ports.conf
\# sysctl --system
```

(There are all sorts of other configurations you can use for HTTPS; see the README file for all the gory details.)

## Cookbook for serving an Anvil app from a public Linux server

If you have a fresh, internet-accessible Linux server running Ubuntu or Rasbian, and an Anvil app ready to serve, the following sequence of commands will set up and serve your app:

```bash
$ sudo su
\# apt update
\# apt install openjdk-8-jdk python3.7 virtualenv
\# echo 'net.ipv4.ip_unprivileged_port_start=0' > /etc/sysctl.d/50-unprivileged-ports.conf
\# sysctl --system
\# exit
$ virtualenv -p python3 venv
$ . venv/bin/activate
$ pip install anvil-app-server
$ git clone git@anvil.works:2222/SOME_APP.git MyApp
$ anvil-app-server --app MyApp --origin https://my-hostname.example.com
```


## More configuration options

For more information on configuring the standalone runtime, see the docs, which you can find at: https://github.com/anvil-works/anvil-runtime
