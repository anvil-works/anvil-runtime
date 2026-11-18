I just want to run the tests

1. ./run_tests

The test image runs `lein clean` and `lein uberjar`, then checks production crypto
operations using only that JAR on the classpath: PEM key conversion, SAML certificate
generation, Buddy RSA JWT verification, and secrets encryption/decryption. A locally
signed SAML fixture exercises the production callback with AES-CBC and AES-GCM
encrypted assertions and RSA-OAEP key wrapping, checking the returned identity and
rejection of a tampered signature. This does not require an external identity provider.

The smoke test launches the JAR with `java -jar`, so development
dependencies cannot hide missing packaged classes. The existing downlink sources
in the image are used; this does not test Python wheel installation.

The smoke test starts a fresh App Server and embedded database for each of three
Data Tables configurations: legacy, accelerated, and split storage. It checks app
startup, the physical PostgreSQL storage mode, and adding and counting rows through
server functions. The storage check catches a split-enabled app silently creating
combined tables even when its row operations succeed.

Adding a new tests/test apps

1. For each test file you must choose a test app to run against.
2. To add an new test app, add a new app to the apps directory
3. Create a conf file in the app's directory
4. In your test fixture create your server with app_server_set_up.set_up_app_server("test app folder name")

To check an existing JAR on a particular JVM without rebuilding it:

```bash
/path/to/jdk/bin/java -cp /path/to/anvil-app-server.jar clojure.main runtime/tests/packaged_crypto.clj
```

Run this from the repository root. Server CI also builds the uberjar and runs this
crypto check on both its build JDK and Java 21, the minimum supported App Server
version. A passing check covers those JVMs only; it is not a matrix of all Java
versions and vendors.

The crypto check uses the providers selected by production code. Forcing a Bouncy
Castle JCE cipher would fail on Oracle JDK because the uberjar does not preserve
BC's signed JAR, but would not demonstrate a failure of these production operations.
