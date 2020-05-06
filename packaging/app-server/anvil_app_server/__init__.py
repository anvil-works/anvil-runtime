import os.path, sys, subprocess, shlex, zipfile, progressbar

if sys.version_info < (3,0,0):
    import urllib
    _urlretrieve = urllib.urlretrieve
else:
    import urllib.request
    _urlretrieve = urllib.request.urlretrieve


def launch():
    jar_path = find_or_download_app_server()
    java_args = ["java", "-jar", jar_path]
    try:
        return_code = subprocess.call(java_args + sys.argv[1:])
    except KeyboardInterrupt:
        return_code = 0
    sys.exit(return_code)


def create_app():
    # User invokes script with
    # `create-anvil-app <template_name> <directory_name>`

    # Unzip the zip file corresponding to the template_name into a directory called directory_name
    TEMPLATES = {
      'hello-world': {'filename':'Default.zip','description':'A simple Anvil app in Material Design theme'},
      'blank': {'filename':'Blank.zip','description':'A blank Anvil app in Material Design theme'},
      'todo-list': {'filename':'TodoList.zip','description':'A simple To-do list (CRUD) app in Material Design theme'},
    }

    def describe_templates():
        for name, info in TEMPLATES.items():
            print("    {}: {}".format(name, info['description']))
        print("\nFor example:\n\n   create-anvil-app todo-list ToDoList\n")


    # Condition on template_name being correct || Give helpful error messages if the template_name provided doesn't exist

    # Verify length of sys.argv first
    if len(sys.argv) != 3:
        print("\nPlease specify both a template app and directory_name, in the format:\n\n    create-anvil-app <template_name> <directory_name>\n")
        print("The template_name can be:\n")
        describe_templates()
        sys.exit(1)

    template_input = sys.argv[1]

    if template_input not in TEMPLATES:
        # Tells user what templates are available
        print("\nTemplate '{}'' does not exist. Please choose from one of the following:\n".format(template_input))
        describe_templates()
        sys.exit(1)

    # Find zip file corresponding to name
    filename = TEMPLATES[template_input]['filename']
    directory_name = sys.argv[2]
    package_dir = os.path.dirname(__file__)
    package_dir_path = os.path.join(package_dir, filename)

    # Unzip file
    with zipfile.ZipFile(package_dir_path, 'r') as zip_ref:
        zip_ref.extractall(directory_name)

    print("""
Congratulations! Your new Anvil app is created, using the '{}'
template. To serve this app, run:

anvil-app-server --app {}

""".format(template_input, directory_name))


def psql():
    data_path = ".anvil-data"
    if len(sys.argv) > 2:
        print("Usage: psql-anvil-app-server [<data-dir>]")
        sys.exit(1)
    elif len(sys.argv) == 2:
        data_path = sys.argv[1]

    print("Looking for postmaster.opts in {} ...".format(data_path+os.path.sep))
    print("(Use 'psql-anvil-app-server <data-dir>' to look somewhere else.)")

    opts_path = os.path.join(data_path,"db","postmaster.opts")
    try:
        with open(opts_path, "r") as f:
            opts = f.read()
    except OSError:
        print("Could not open {}. Is {} an Anvil App Server data directory?".format(opts_path, data_path))
        sys.exit(1)

    port = None
    last = None
    for opt in shlex.split(opts):
        if last == "-p":
            port = int(opt)
            break
        else:
            last = opt

    if port is None:
        print("Could not determine Postgres port from {}.\nIs {} an Anvil App Server data directory?".format(opts_path, data_path))
        sys.exit(1)

    pw_path = os.path.join(data_path, "postgres.password")
    try:
        with open(pw_path, "r") as f:
            os.environ["PGPASSWORD"] = f.read()
    except OSError:
        print("Could not open {}. Is {} an Anvil App Server data directory?".format(pw_path, data_path))
        sys.exit(1)

    #print("To access data tables, run: SET SEARCH_PATH=data_tables;")
    print("psql -h localhost -p {} -U postgres postgres".format(port))
    os.system("psql -h localhost -p {} -U postgres postgres".format(port))


def find_or_download_app_server():
    # Work out whether we already have the server JAR file. It could be in the package itself, or in ~/.anvil
    package_dir = os.path.dirname(__file__)
    home_dir = os.path.expanduser("~")
    server_jar_name = "anvil-app-server.SNAPSHOT.jar"

    package_dir_path = os.path.join(package_dir, server_jar_name)
    home_dir_path = os.path.join(home_dir, ".anvil", server_jar_name)

    if os.path.isfile(package_dir_path):
        print("Found Anvil App Server JAR in package directory")
        return package_dir_path
    if os.path.isfile(home_dir_path):
        print("Found Anvil App Server JAR in ~/.anvil directory")
        return home_dir_path

    # If we don't have it, download it to the package if possible, or to ~/.anvil if not possible.
    progress = { "bar": None, "downloaded": 0 }
    def show_progress(count, block_size, total_size):
        if progress['bar'] is None:
            progress['bar'] = progressbar.DataTransferBar(max_value=total_size)

        progress['downloaded'] = count * block_size
        if progress['downloaded'] >= total_size:
            progress['bar'].finish()
            progress['bar'] = None
            progress['downloaded'] = 0
        else:
            progress['bar'].update(progress['downloaded'])


    url = "https://anvil-public-assets.s3.eu-west-2.amazonaws.com/app-server/" + server_jar_name
    try:
        print("Downloading Anvil App Server JAR to package directory")
        _urlretrieve(url, package_dir_path, show_progress)
        print("Downloaded Anvil App Server JAR to package directory")
        return package_dir_path
    except Exception:
        print("Failed to download App Server to package directory. Retrying in ~/.anvil")
        _urlretrieve(url, home_dir_path, show_progress)
        print("Downloaded Anvil App Server JAR to ~/.anvil directory")
        return home_dir_path


if __name__ == "__main__":
    launch()
