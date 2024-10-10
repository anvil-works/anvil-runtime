# The Anvil app structure explained

[Anvil](https://anvil.works) is a platform for building full-stack web apps with nothing but Python. The Anvil Runtime is the open-source engine that powers those apps.

The [Anvil App Server](../README.md) serves Anvil apps, which follow a certain directory structure. You can create an Anvil app from scratch using your Text Editor, using the [create-anvil-app](creating-and-editing-apps.md) command, or by [cloning an app with Git](https://anvil.works/docs/version-control-new-ide/git) from the [online IDE](https://anvil.works/build) (the [Anvil Editor](https://anvil.works/docs/editor)).

## Anvil app structure

Each app is represented by a directory named using the app name. 

The top-level directory is a Python package, with an `__init__.py` file.

The basic structure of an app named `MyApp` with one client-side [Form](https://anvil.works/docs/client/components/forms), one client-side [Module](https://anvil.works/docs/client/python/modules), and one [Server Module](https://anvil.works/docs/server) is as follows:

```
MyApp
├── __init__.py
├── client_code
│   ├── Form1 # package Form
│   │   ├───__init__.py
│   │   └───form_template.yaml
│   └── Module1.py
├── server_code
│   └── ServerModule1.py
├── theme
│   ├── parameters.yaml
│   ├── templates.yaml
│   └───assets
│       ├── standard-page.html
│       └───theme.css
└── anvil.yaml
```

The files in this directory are everything Anvil uses to represent an app.

### The structure explained

* `__init__.py`: Sets the Python path for the app
* `client_code`: This is an ordinary Python source tree containing the code and config for your client-side Forms and Modules. 
  * `<form name>`: Each Form, by default, is a Python package; a directory containing an `__init__.py` file (plus a config file defining the design layout). The Python code for each Form is in a separate file. 
    * `__init__.py`: The Python code for each Form is in this file. This is exactly the code you see in the Code View of the Editor.
    * `form_template.yaml`: This file defines the Form's template, its properties, its components and their properties. It is a representation of what the visual designer knows about that Form.
  * `<module name>.py`: This is an ordinary Python module, and contains exactly the code you see in your Module in the Editor.
* `server_code`: This is an ordinary Python source tree containing the code for your Server Modules. 
  * `<server module name>`: The Python code for each Server Module is in this file. This is exactly the code you see in your Server Modules in the Editor. 
* `theme`: This contains the configuration files relating to the functionality found in the Theme section of the App Browser.
  * `parameters.yaml`: This file defines the Form's roles and colour scheme.
  * `templates.yaml`: This file is only used by the Editor (you don't need it to run apps in your local environment). It specifies the Form templates available when adding a new Form in the Editor.
  * `assets`: The files contained in the Assets part of the Theme section. 
    * `standard-page.html`: The `standard-page` HTML template. 
    * `theme.css`: The app theme's CSS. 
* `anvil.yaml`: The configuration relating to your app as a whole. This is explained in detail below.


Forms can also be stored as Python Modules. If you have an older version of an Anvil app, your Forms will probably be stored as Python Modules - we no longer recommend creating Forms this way. Forms stored as Modules will be stored in the following format, inside the `client_code` directory:
  * `<form name>.py`: The Python code for the Form is stored in this `.py` file, and this is exactly the code you see in the Code View of the Editor. It's equivalent to the `__init__.py` file for a Form stored as a Python package. 
  * `<form name>.yaml`: This file defines the Form's template, its properties, its components and their properties. It is a representation of what the visual designer knows about that Form. It's equivalent to `form_template.yaml` for a Form stored as a Python package. 


## anvil.yaml

`anvil.yaml` is responsible for the global configuration of your app, including configuration of Services and your database schema. It accepts the following configurations:

```
  dependencies                  Information on any app dependencies
  scheduled_tasks               The configuration of any scheduled tasks
  package_name                  The name of the top-level Python package
  allow_embedding               Whether or not embedding is enabled for your app
  name                          The name of the app
  runtime_options               The client-side Python version for your app
  metadata                      The Title, Description, and Logo (favicon) for your app
  startup                       specifies the Form or Module that should load when a user opens your app in their browser
  native_deps                   Any native libraries your app depends on (inserted into the `<head>` tag of your Anvil app’s HTML)
  services                      Anvil services used by the app and their configuration
  db_schema                     Your database schema
```

In turn:

### Dependencies

Anvil apps can use [Forms](https://anvil.works/docs/client/components/forms), [Custom Components](https://anvil.works/docs/client/custom-components) and code from another Anvil app by adding them as [dependencies](https://anvil.works/docs/deployment/dependencies). Dependencies should be specified in your `anvil.yaml` file. 

Here is an example entry in `anvil.yaml` that adds an existing Anvil app with ID "ZBDT7UM6GVGR7W4D" as a dependency. It uses the ["published" version](https://anvil.works/docs/deployment/production-vs-development) of this dependency:

```
dependencies:
- app_id: ZBDT7UM6GVGR7W4D
  version: {branch: "master"}
```

You will also need to inform the Anvil App Server of any dependencies when launching your apps locally, either on the command line or in a config file. See the [README](../README.md) for more information. 


### Scheduled Tasks

[Scheduled Tasks](https://anvil.works/docs/background-tasks/scheduled-tasks) are [Background tasks](https://anvil.works/docs/background-tasks) that run on a schedule you configure, leaving your main program to continue executing while the task is running.

Here is an example entry in `anvil.yaml` for an app that has the following Scheduled Tasks configured:

* Run background task 'slow' every 10 minutes
* Run background task 'launch' every 5 days, at 03:00 UTC
* Run background task 'monthly_update' on the 21st of each month, at 10:00 UTC

`job_id` is a unique string for each task, which is used to track when it last ran.

```
scheduled_tasks:
- task_name: slow
  time_spec:
    n: 10
    every: minute
    at: {}
  job_id: QMUPCYEH
- task_name: launch
  time_spec:
    n: 5
    every: day
    at: {hour: 3, minute: 0}
  job_id: YKTLUUWJ
- task_name: monthly_update
  time_spec:
    n: 1
    every: month
    at: {hour: 10, minute: 0, day: 21}
  job_id: VHPWDKAE
```

### Package name 

This is the name of the top-level Python package. Your app (or its dependencies) will use this in absolute `import` statements.

Sample configuration in `anvil.yaml`:

```
package_name: MyApp
```

### Allow embedding 

`allow_embedding` specifies whether or not [embedding](https://anvil.works/docs/deployment#embedding-your-app-in-another-web-page) is enabled for your app, and takes a boolean value.

Sample configuration in `anvil.yaml`:

```
allow_embedding: false
```

### Name

`name` specifies the human-readable name of your app. 

Sample configuration in `anvil.yaml`:

```
name: My App
```

### Runtime options

`runtime_options` is used by the Anvil App Server to determine which Python interpreter should run your client-side code. It takes a dict of key-value pairs, with the following keys:

  * `version`: should always be set to 2
  * `client_version`: the version number for your [client-side Python](https://anvil.works/docs/client/python). This should be set to `'3'` for all modern apps.
  * `server_persist`: should be set to `true` if you want to enable [Persistent Server Modules](https://anvil.works/docs/server#persistent-server-modules).

(The `server_version` key does not affect the standalone App Server and is used only in Anvil's hosted environment. Your server modules run in the Python environment in which you launched `anvil-app-server`.)

Here is an example entry in `anvil.yaml` for an app running Python version 3 client-side:

`runtime_options: {version: 2, client_version: '3'}`

### Metadata

`metadata` stores the configuration of your app's metadata: 'Title', 'Description' and 'Logo' (favicon and social sharing image).

Here is an example entry in `anvil.yaml` for an app with a Title, Description and Logo configured. 'logo.jpg' is a file stored in `theme/assets` in the app directory. 

```
metadata:
  title: My App Title
  description: 'This is my Anvil app, created with nothing but Python.'
  logo_img: 'asset:logo.jpg'
```

### Startup Form

[`startup`](https://anvil.works/docs/client/python#when-your-app-starts) specifies the Form or Module that should load when a user opens your app in their browser. You can change your startup module in `anvil.yaml`.

Here is an example entry in `anvil.yaml` that loads a Form:

`startup: {type: form, module: scripts.Launch}`

The `startup` option takes a dict with two keys:

 * `type` is `form` or `module`, which determines how the module is imported.
   - A `module` is run as a script (as though you had launched it from the command line with `python -m my_module`)
   - A `form` is a Python package; a directory containing an `__init__.py` file (plus a config file defining the design layout). The `__init__.py` file is executed when the app starts. 

 * `module` is the name of the Form or Module that loads when the app is opened in a user's browser. It is specified relative to the `client_code` directory. 

For example, for an app with the below structure, to set 'Home' as the startup Form, you would add the following to `anvil.yaml`:

`startup: {type: form, module: Package1.Home}`

```
client_code
└── Package1 # package Form
    └───__init__.py
    └── Home # package Form
        └───__init__.py
        └───form_template.yaml
```

Older apps may have a `startup_form` key in `anvil.yaml` instead. The configuration:

`startup_form: Form1`

has the same effect as:

`startup: {type: form, module: Form1}`


### Native Libraries

[Native Libraries](https://anvil.works/docs/client/javascript#using-native-javascript-libraries) allow you to use Native Javascript Libraries with Anvil. You can do this by configuring a `native_deps` string in your `anvil.yaml` file. Anything passed to `head_html` within `native_deps` will be  inserted into the `<head>` tag of your Anvil app's HTML.

Here is an example entry in `anvil.yaml` for an app that uses the D3 and Chartjs external libraries. 

```
native_deps:
    head_html: |
      <script src="//d3js.org/d3.v4.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js@2.9.3/dist/Chart.min.js"></script>
```

### Services

Anvil provides the following services:

1. [Data Tables](https://anvil.works/docs/data-tables)
2. [Users](https://anvil.works/docs/users)
3. [Email](https://anvil.works/docs/email)
4. [App Secrets](https://anvil.works/docs/security/encrypting-secret-data)
5. [Google API](https://anvil.works/docs/integrations/google)
6. [Facebook API](https://anvil.works/docs/integrations/facebook)
7. [Microsoft API](https://anvil.works/docs/integrations/microsoft)
8. [Stripe](https://anvil.works/docs/integrations/stripe)

These are all configured in your `anvil.yaml` file. 

In turn:

#### Data Tables

Anvil's [Data Tables](https://anvil.works/docs/data-tables) service is a full database system built on top of PostgreSQL. 

You can add the Data Tables service in `anvil.yaml`, as well as configuring the service itself. 

Here us an example entry in `anvil.yaml` to add the Data Tables service to an app:

```
services:
- source: /runtime/services/tables.yml
  client_config: {}
  server_config: {auto_create_missing_columns: false}
```

(Setting `auto_create_missing_columns` to `true` will give the Data Tables service permission to automatically create columns in the database if a new row is added that contains columns not present in the database. It is not recommended!)

`anvil.yaml` also contains the schema for the Data Tables service. The configuration you'll need for each Data Table is as follows:

* `name`: the name of the table
* `python_name`: the python name you'll use to access this table e.g `app_tables.<python_name>.search()`
* `id`: unique ID for this table (can take any unique value)
* `columns`: key-value map specifying column configuration (see below)
* `access`: key-value map to specify the python_name, and the client-side and server-side [Data Table permissions](https://anvil.works/docs/data-tables/data-security) (see below).

#### Access

`access` allows you to configure both client-side and server-side [Data Table permissions](https://anvil.works/docs/data-tables/data-security). They can take any of the following:

* `none` - Your code will not be able to search, update, or edit the table. If it gets a row from this table (eg returned from a server function), it can read that row and any linked rows. But it cannot update or delete that row.
* `search` - Your code can call search() and get() on this table, and read all the data in its rows (and linked rows). However, it cannot add new rows, or update or delete existing rows.
* `full` - Your code can perform any operation on this table.

#### Columns

Here is an example of the configuration in `anvil.yaml` for a Data Table with two columns:

```
columns:
  f+sBlXoTQLc=:
    name: name
    type: string
  yVT6iYShb1M=:
    name: favourite_colour
    type: liveObject
    backend: anvil.tables.Row
    table_id: 1
```

The configuration you'll need for each column in your Data Table is as follows:

* unique id (can be any unique identifier)
  * `name`: column name
  * `type`: column type (see below)
build).
  * `backend` (OPTIONAL): only for columns of type `liveObject` or `liveObjectArray`, and should be set to `anvil.tables.Row` if required.
  * `table_id` (OPTIONAL): only for columns of type `liveObject` or `liveObjectArray`, and should be set to the ID of the linked Data Table if required.

  (The Anvil Editor also creates an `admin_ui` key; this is for the [Anvil Editor](https://anvil.works/) and is ignored by the App Server.)

Notice that each `column` identifier first specifies a unique ID for each column e.g. `ZCAxSrfNkuQ=` in the example above. This can be any unique identifier. 

The available column types are listed below, along with their corresponding python types.

* `string` - A Python `str`
* `number` - Any Python number
* `bool` - A Python boolean, `True` or `False`
* `date` - A Python `datetime.date`
* `datetime` - A Python `datetime.datetime`
* `simpleObject` - Can hold Python strings, numbers, dicts, lists or `None` (ie JSON data)
* `media` - Binary data (an Anvil [Media object](https://anvil.works/docs/working-with-files/media))
* `liveObject` - A row from another table
* `liveObjectArray` - A list of rows from another table

`liveObject` and `liveObjectArray` column types require two additional pieces of column configuration: `backend`, and `table_id`:
* `backend`: should always be set to `anvil.tables.Row`
* `table_id`: the ID of the Data Table the linked row relates to

Here's an example of the complete Data Table configuration entry in `anvil.yaml` for an app with two Data Tables: 'colours', and 'people'. It adds the Data Tables service, and configures the `db_schema`. 

The 'colours' table has the following columns:
  
  - `name` (`string` column)

The 'people' table has the following columns:

  - `name` (`string` column)
  - `favourite_colour` (`liveObject` column: Link to 'colours' table)

```
services:
- source: /runtime/services/tables.yml
  client_config: {}
  server_config: {auto_create_missing_columns: false}
db_schema:
- name: colours
  id: 1
  python_name: colours
  columns:
    ZCAxSrfNkuQ=:
      name: name
      type: string
  access: {python_name: colours, server: full, client: none,
    table_id: 1}
- name: people
  id: 2
  python_name: people
  columns:
    f+sBlXoTQLc=:
      name: name
      type: string
    yVT6iYShb1M=:
      name: favourite_colour
      type: liveObject
      backend: anvil.tables.Row
      table_id: 1
  access: {python_name: people, server: full, client: none,
    table_id: 2}
```

The App Server will check the `db_schema` provided in `anvil.yaml`, and compare this to the database in the local data directory (default: .anvil-data). 

If the database is already configured with a different schema, the App Server will ask you to either migrate the changes to your local database, or ignore the schema specified in your `anvil.yaml` file. See the [README](../README.md) for more information.

#### Users

Anvil's [Users Service](https://anvil.works/docs/users) handles authentication, including signup, login and user permissions, and provides a range of functionality to make user management easy and flexible.

The best way to enable the Users Service is to enable it in the [online IDE](https://anvil.works/build), and then [clone your app onto your local machine](https://anvil.works/docs/version-control-new-ide/git). You can also enable the Users Service in `anvil.yaml`, as well as configuring the service itself. 

If you're using the Users Service, user accounts are stored in a Data Table, conventionally called "users" (see above for information on Data Tables).

The Users service supports a number of [sign-in methods](https://anvil.works/docs/users/authentication_choices). These are configured using `client_config` in the `anvil.yaml` entry. The `server_config` tells the database which of your Data Tables should be used to store user accounts. By convention, this should be "users".

In some configurations, the Users Service will send emails to users (for example, to confirm ownership of an email address). You can optionally configure the address from which these messages are sent by configuring `email_from_address`, and the content of these messages with `email_content`. The email identifiers are:

 - `confirm_address` - Confirm ownership of the email address for a new account (parameterised by `{{confirm_link}}`, the link to click). Sent when `use_email` and `allow_signup` are enabled in `client_config`.

 - `reset_password` - Reset the password for an account by email (parameterised by `{{reset_link}}`, the link to click, and `{{email}}`, the email address). Sent when `use_email` is enabled in `client_config`.

 - `token_login` - Log in with a "magic link", aka "passwordless" login. Sent when `use_token` is enabled in `client_config`.

 - `mfa_reset` - Reset a user's two-factor authentication device by email. Sent when `allow_mfa_email_reset` is enabled in `client_config`.

Here's an example entry in `anvil.yaml`, produced by enabling the Users Service in the online IDE. It adds and configures the User Service (the Data Tables service is required to use the Users service):

```
services:
- source: /runtime/services/tables.yml
  client_config: {}
  server_config: {auto_create_missing_columns: false}
- source: /runtime/services/anvil/users.yml
  client_config: {require_secure_passwords: true, share_login_status: true,
    use_email: true, use_token: true, allow_remember_me: true, allow_signup: true,
    enable_automatically: true, confirm_email: true, require_mfa: true, mfa_timeout_days: 30,
    remember_me_days: 7, use_google: false, use_facebook: false, use_microsoft: false, use_saml: false}
  server_config: 
    user_table: 'users'
    email_from_address: something@my-domain.com
    email_content:
      token_login:
        subject: "My App Login"
        html: "<p>Hi there,<p>A login request was received for your account ({{email}}). To log in, click the link below:<p>{{login_link}}<p>This link will expire in ten minutes."

      mfa_reset:
        subject: "My App Authentication Reset"
        html: "<p>Hi there,<p>A two-factor authentication reset request was received for your account {{email}}. To continue, click the link below.<p>{{login_link}}<p>This link will expire in ten minutes."

      confirm_address:
        subject: "Confirm your email address"
        html: |
          <p>Thanks for registering your account with us. Please click the following link to confirm that this is your account:
          <p>{{confirm_link}}
          <p>Thanks
          <p>The team

      reset_password:
        subject: "Reset your password"
        html: "<p>Hi there,<p>You have requested a password reset for your account {{email}}. To reset your password, click the link below:<p>{{reset_link}}<p>This link will expire in ten minutes."

db_schema:
- name: Users
  id: 3
  python_name: users
  columns:
    Jiv3u_GvZ+M=:
      name: email
      type: string
      admin_ui: {order: 0, width: 200}
    e5qNZNN248Y=:
      name: enabled
      type: bool
      admin_ui: {order: 1, width: 100}
    haSy3ivjtXM=:
      name: signed_up
      type: datetime
      admin_ui: {order: 2, width: 200}
    aHRjjIgDub0=:
      name: password_hash
      type: string
      admin_ui: {order: 3, width: 200}
    uJDnnYdBrt8=:
      name: confirmed_email
      type: bool
      admin_ui: {order: 4, width: 100}
    jUfJHJ+557v=:
      name: email_confirmation_key
      type: string
      admin_ui: {order: 5, width: 200}
    jALyyGoERn0=:
      name: last_login
      type: datetime
      admin_ui: {order: 6, width: 200}
  access: {python_name: users, server: full, client: none, table_id: 3}
```

For more information on the Users Table, and the columns in the `db_schema` above, see the [reference docs](https://anvil.works/docs/users/the_users_table)

#### Email

Your apps can send and receive email using the built-in [Email Service](https://anvil.works/docs/email).

To add the Email Service to your app, you need the following entry in your `anvil.yaml` file:

```
- source: /runtime/services/anvil/email.yml
  client_config: {}
  server_config: {}
```

See the [README](../README.md) for more information on configuring the App Server to send and receive emails from your app. 
  
#### App Secrets

Anvil's [App Secrets service](https://anvil.works/docs/security/encrypting-secret-data) provides easy-to-use access to secrets (e.g. passwords) that aren't in your source code, and encryption and decryption of data.

You can add the App Secrets service in your `anvil.yaml` file:

```
- source: /runtime/services/anvil/secrets.yml
  client_config: {}
  server_config: {}
```

For the App Server, the values of secrets and encryption keys are provided on the command line or in a config file, using the `secret` and `encryption-key` options (see the [README](../README.md) for details).

(In the hosted Anvil platform, the values of your secrets are stored, encrypted, in your application. The platform provides key management and access control before decrypting these values. If you have exported your app from the Anvil Editor, you may see a `secrets:` key in `anvil.yaml` that contains these encrypted values. They cannot be extracted without the per-app keys stored in the Anvil platform, and are thus ignored by the App Server.)

Encryption with `anvil.secrets.encrypt_with_key()` is performed using 128-bit AES-GCM:

  * The value of an encryption key is a base64-encoded 128-bit AES key.
  * The encrypted payload is base64 encoded.
  * Encryption is done using AES-GCM, with the IV transmitted as the first 12 bytes of the payload

#### Google API

Anvil has built-in [Google integration](https://anvil.works/docs/integrations/google)

This provides access to the following:

* [Authentication](https://anvil.works/docs/integrations/google/authenticating-users) - Log users in with their Google accounts
* [Drive](https://anvil.works/docs/integrations/google/google-drive) - Read and write files from your own Google Drive, and the Google Drives of your users (with permission)
* [Google Sheets](https://anvil.works/docs/integrations/google/google-drive#google-sheets) - Anvil has a Python API for accessing worksheets, fields, rows and cells in Google Sheets
* [Gmail](https://anvil.works/docs/integrations/google/gmail) - You can send email with your Gmail account (although consider the Anvil [Email Service](email))
* [Google REST APIs](https://anvil.works/docs/integrations/google/google-rest-apis) - You can easily get and refresh an access token to use with Google's many REST APIs. Then you can use `requests` or `anvil.http.request` to make calls to these APIs.


You can add the Google Service in your `anvil.yaml` file, and then specify the `google-client-id` and `google-client-secret` options in your [App Server configuration](../README.md#service-integrations-and-api-keys). This will allow you to use Google authentication, access your users' Drive files (with the appropriate scopes) and access Google's REST APIs:

```
- source: /runtime/services/google.yml
  client_config: {}
  server_config: {}
```

(Note: Some apps exported from the Anvil hosted platform will contain app ID and secrets in the `server_config` of this service. This is not necessary for the App Server.)

<!-- TODO: Test and write instructions for self-setup of App Files. -->


#### Facebook API

Anvil has built-in [Facebook integration](https://anvil.works/docs/integrations/facebook)

This provides access to the following:

  * [Authentication using Facebook accounts](https://anvil.works/docs/integrations/facebook/quickstart) - allow users to sign-in using their Facebook accounts.
  * [Facebook REST APIs](https://anvil.works/docs/integrations/facebook/linking-facebook-and-anvil#authenticate-with-facebook-and-get-an-access-token) - you can easily get an access token to use with Facebook's REST APIs.

To connect Anvil with Facebook, you need to create an 'app' in [Facebook for Developers](https://developers.facebook.com/).
For our purposes, this is just a record held by Facebook to inform it of your Anvil app. You will receive an App ID and App Secret, which you should supply using the `facebook-app-id` and `facebook-app-secret` options in the App Server configuration (see the [README](../README.md)).

Here's an example entry in `anvil.yaml` to add the Facebook Service:

```
services:
- source: /runtime/services/facebook.yml
  client_config: {}
  server_config: {}
```

(Note: Some apps exported from the Anvil hosted platform will contain app ID and secrets in the `server_config` of this service. This is not necessary for the App Server.)


#### Microsoft API

Anvil has built-in [Microsoft integration](https://anvil.works/docs/integrations/microsoft)

This provides access to the following:

  * [Authentication using Microsoft accounts](https://anvil.works/docs/integrations/microsoft/microsoft-single-sign-on) - allow users to sign-in using their Office 365, Skype and other Microsoft accounts.
  * [Microsoft Azure REST APIs](https://anvil.works/docs/integrations/microsoft/accessing-microsoft-apis) - You can easily get and refresh an access token to use with Microsoft Azure's many REST APIs. Then you can use `anvil.http.request` to make requests against the APIs.

To use Anvil’s Microsoft integration, you need to let Microsoft Azure know about your app, and obtain an app ID and secret. See [connecting Azure to Anvil](https://anvil.works/docs/integrations/microsoft/linking-azure-and-anvil) for more information.

Supply the application ID, secret and Tenant ID (if applicable) to the App Server configuration (see the [README](../README.md)).

This service's `server_config` in `anvil.yaml` can specify additional OAuth scopes to request (if any). `additional_oauth_scopes` takes a comma-separated string of scopes.

Here's an example entry in `anvil.yaml` which adds and configures the Microsoft Service:

```
- source: /runtime/services/anvil/microsoft.yml
  client_config: {}
  server_config: {additional_oauth_scopes: 'User.Read,User.Write'}
```

(Note: Some apps exported from the Anvil hosted platform will contain app ID and secrets in the `server_config` of this service. This is not necessary for the App Server.)

<!-- #### Stripe Integration

Anvil has built-in [Stripe integration](https://anvil.works/docs/integrations/stripe)

This enables you to:

  * [Take payments using a built-in payment form](https://anvil.works/docs/integrations/stripe/payments-and-subscriptions#taking-one-off-payments) - this can be customised with your own title, description and icon.
  * [Take payments using Python code](https://anvil.works/docs/integrations/stripe/payments-and-subscriptions) - allowing you to build your own payment form and/or workflow. You can also associate multiple payments with one customer.
  * [Manage recurring subscriptions](https://anvil.works/docs/integrations/stripe/payments-and-subscriptions#recurring-subscriptions).

`anvil.yaml` stores your Stripe publishable keys, whether the Stripe service is in 'Live' or 'Test' mode, and your Stripe user ID.  

Here's an example entry in `anvil.yaml` which adds and configures the Stripe Service:

```
- source: /runtime/services/stripe.yml
  client_config:
    publishable_key: {test: pk_test_oamqeDSiiptnh8wGphL7WPil00VMFq3nQT, live: pk_live_gaifNGbrhvTGKs4YNvDJvKts00Poewn4cX}
    live_mode: false
  server_config: {stripe_user_id: acct_1ErLVdJZZZSJNMFt}
```


 -->






















