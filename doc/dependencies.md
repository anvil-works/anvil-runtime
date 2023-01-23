# Anvil App Server Dependencies

[Anvil](https://anvil.works) gives you the ability to reuse [Forms](https://anvil.works/docs/client/components/forms), [Custom Components](https://anvil.works/docs/client/custom-components) and code from one Anvil app in another.

Follow this how-to guide to learn how to take two apps that depend on one another, [clone them onto your local machine](https://anvil.works/docs/version-control/git), and run them locally using the Anvil App Server. For information on how dependencies work in Anvil, see the [reference docs](https://anvil.works/docs/deployment/dependencies).

### Prerequisites

Before continuing with this guide, please make sure you have installed the Anvil App Server - see the [getting started guide](doc/getting-started.md) for information.

<!-- This guide is intended for use after you have set up the Anvil standalone runtime by following the [getting started guide](doc/getting-started.md) and have [cloned your app](https://anvil.works/docs/editor/cloning) to your local machine.
 -->
### Dependencies and the Anvil App Server

<!-- The App Server looks for dependencies in the _parent directory_ of the app (that is, dependency apps should be checked out _next to_ the main app directory, not inside it).

You can specify multiple dependencies on the command line with multiple `--dep-id` flags:
 -->
When running apps locally using the Anvil App Server, there are a few steps you need to take to tell the App Server how to maintain the relationship between dependencies. We'll walk you through this process below with an example. 

### Clone your main app onto your local machine

Say you have an app called 'MyApp' which depends on another app called ‘HelloWorldApp’. 

The first step is to [clone your main app (MyApp)](https://anvil.works/docs/version-control/git) onto your local machine:

```bash
# Clone MyApp into a local directory named 'MyApp'
$ git clone ssh://ryan%40anvil.works@anvil.works:2222/CV34NZGOVZV7NFHE.git MyApp
```

<!-- 'MyApp' depends on the 'HelloWorld' Module from another app called 'HelloWorldApp'. -->

### Cloning HelloWorldApp

The Anvil App Server requires both the main app and the dependency to be checked out locally. The App Server looks for dependencies in the _parent directory_ of the main app (that is, dependency apps should be checked out _next to_ the main app directory, not inside it).

The next step is to clone 'HelloWorldApp' into the same parent directory as 'MyApp':

```bash
$ git clone ssh://ryan%40anvil.works@anvil.works:2222/FWM2EMXS4IKC5HZS.git HelloWorldApp
```

Your directory now contains two subdirectories.

```
+-- /anvil-apps/
|   +-- MyApp/
|   +-- HelloWorldApp/
```

### Updating the dependency reference

If an application uses other apps as [dependencies](https://anvil.works/docs/deployment/dependencies), it will refer to these apps with opaque identifiers. If you open the `anvil.yaml` file inside the 'MyApp' (Main) app directory, you'll see an entry in `anvil.yaml` which the Anvil Editor uses to configure dependencies, for example:

```
dependencies:
- app_id: FWM2EMXS4IKC5HZS
  version: {dev: false}
```

This tells Anvil that 'MyApp' depends on an app with ID 'FWM2EMXS4IKC5HZS' - this is the ID for 'HelloWorldApp'. We need to tell the Anvil App Server which app corresponds to ID 'FWM2EMXS4IKC5HZS'.

There are two ways to do this:

#### Configuring dependencies on the command line

You can specify dependencies on the command line with `--dep-id` flags:

```
--dep-id FWM2EMXS4IKC5HZS=HelloWorldApp
```

You would then run MyApp using the Anvil App Server with the following command:

```bash
$ anvil-app-server --app MyApp --dep-id FWM2EMXS4IKC5HZS=HelloWorldApp
```

#### Configuring dependencies in a config file

You can also supply configuration options from a YAML file of keys and values instead of the command line. If you're configuring your application via a config file within your app directory, you can add your dependency configuration to that YAML file.

For more information on config files please see the [README](../README.md).

For example, if you create a `config.yaml` file in the MyApp directory:

```
+-- /anvil-apps/
|   +-- MyApp/
|       +-- config.yaml
|   +-- HelloWorldApp/
```

and add the following to `config.yaml`:

```
dep-id:
  "FWM2EMXS4IKC5HZS": "HelloWorldApp"
```

You could then launch MyApp with the following command:

```bash
$ anvil-app-server --app MyApp --config-file MyApp/config.yaml
```

### Accessing the dependency

'MyApp' now has access to 'HelloWorldApp'. For example, say 'HelloWorldApp' contains a Module named 'HelloWorldModule'. You can now access this Module from 'MyApp':

```python
from HelloWorldApp import HelloWorldModule

class Form1(Form1Template):

  def __init__(self, **properties):
    # Set Form properties and Data Bindings.
    self.init_components(**properties)

    # Any code you write here will run before the form opens.

    # Call the `say_hello` method in HelloWorldModule
    text = HelloWorldModule.say_hello()
    # Display the result of `say_hello` on Form1
    self.add_component(Label(text=text))
```

<!-- TODO: check if we need a troubleshooting section -->

## Troubleshooting

```
The app you requested could not be loaded.
This app may be misconfigured. The following error occurred:

App dependency not found
```

This usually means the application cannot find its dependency. The following checks may be helpful:
* Check you’re using the correct dependency ID
* If you’re using one, check the Config file is in the correct place in your directories
* Check that both apps are in the same parent directory
