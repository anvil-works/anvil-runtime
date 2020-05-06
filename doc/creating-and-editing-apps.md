# Creating Anvil apps locally

You can create and edit Anvil apps locally using your favourite Text Editor. Follow this how-to guide to create and run a template Anvil app on your own machine.

Before continuing with this guide, please make sure you have installed the Anvil App Server - see the [getting started guide](getting-started.md) for information.

## Create your app

You can create a template app on your local machine with this command:

```bash
$ create-anvil-app <template-name> <app-directory-name>
```

This creates an Anvil app from the template specified, and places it in a directory named `<app-directory-name>`. 

`create-anvil-app` comes with three templates to choose from:

1. `todo-list`: a simple to-do list (CRUD) app, complete with database configuration, and styled using the Material Design theme.
2. `hello-world`: a simple, interactive "Hello, World!" app, styled using the Material Design theme.
3. `blank`: a blank Anvil app styled using the Material Design theme.

For example, to create a todo-list app locally in a directory named 'MyTodoList', you would run the following command:

```bash
$ create-anvil-app todo-list MyTodoList
```

You can run this template app locally with this command:

```bash
# Run the template app we downloaded into the 'MyTodoList' directory
$ anvil-app-server --app MyTodoList
```

This means you can create and serve a template app locally with just three commands:

```bash
$ pip install anvil-app-server
$ create-anvil-app todo-list MyTodoList
$ anvil-app-server --app MyTodoList
```

All template apps created using the `create-anvil-app` command will have (as a minimum requirement) the following directory structure:

```
MyApp
├── __init__.py
├── client_code
│   ├── Form1 # package Form
│   │   ├───__init__.py
│   │   └───form_template.yaml
├── server_code
│   └── ServerModule1.py
├── theme
│   ├── parameters.yaml
│   └───assets
│       ├── standard-page.html
│       └───theme.css
└── anvil.yaml
```

To learn more about this directory structure and what each of the files is responsible for, see our [app structure guide](app-structure.md).

## Edit your app

Once you've launched the web server with the `anvil-app-server` command, you can simply refresh your browser to see changes you make locally - there's no need to restart the web server!








