


- service worker is for app-origin resources
- goals:
  - prefer fresh data when the network is healthy
  - avoid blocking on slow network when we already have a usable cached copy
  - keep working through brief offline / flaky periods
  - cache heavyweight runtime files for performance
  - cache app assets for performance

- worker is registered at `APP_ORIGIN/_/service-worker`
- scope is `APP_ORIGIN`
- so requests under the app origin go through it

- examples of requests we care about:
  - `/_/theme/theme.css`
  - `/runtime/js/jquery.min.js?buildTime=...`
  - `/runtime/js/skulpt.min.js?buildTime=...`
  - `/runtime/css/bootstrap-theme.min.css?buildTime=...`
  - `/runtime/js/runner.bundle.js?buildTime=...`
  - `/`

- cache admission:
  - `GET` only
  - `200` only
  - must have `X-Anvil-Cacheable`

- this is server opt-in
- if a response does not have `X-Anvil-Cacheable`, fetch it but do not store it

- cacheable buckets we care about:
  - shared runtime/static files:
    - jQuery
    - Skulpt
    - Bootstrap
    - runtime JS / CSS bundles
  - app-specific assets:
    - `/_/theme/...`
  - app HTML:
    - cacheable, but not with the same freshness story as assets

- three operating modes:
  - `NETWORK_FIRST`
  - `STALE_WITH_REVALIDATE`
  - `CACHE_ONLY`

- `NETWORK_FIRST`:
  - default mode
  - outside IDE: race network against `7500ms`
  - in IDE: always wait for network
  - on success:
    - return network response
    - cache it if cacheable
  - on timeout:
    - return cached match if present
    - let fetch continue in background
    - mark things slow for 5 seconds
  - on network failure:
    - return cached match if present
    - mark things offline for 5 seconds

- `STALE_WITH_REVALIDATE`:
  - used for 5 seconds after a timeout
  - if cache hit:
    - return cached response immediately
    - fetch in background to refresh cache

- `CACHE_ONLY`:
  - used when `navigator.onLine` is false
  - also used for 5 seconds after a network failure
  - if cache hit:
    - return cached response immediately
  - if cache miss:
    - still try network once
  - so "cache only" really means "prefer cache immediately when present"

- cache miss behavior:
  - no offline page synthesis
  - fetch network
  - cache if allowed
  - return network response

- revalidation rules:
  - skip revalidation only when:
    - cached URL and request URL are identical
    - cached response is not `cache-control: no-cache`
    - cached URL carries a real version marker (`sha` or `buildTime != 0`)
  - if cached response has `cache-control: no-cache`, revalidate
  - if cached response has `ETag`, copy it into `If-None-Match`
  - if server returns `304`, keep serving cached body
  - if server returns `200`, replace cached body
  - `buildTime=0` is not treated as a stable version marker

- versioned URL examples:
  - same URL:
    - cached `/runtime/js/jquery.min.js?buildTime=1735678901`
    - request `/runtime/js/jquery.min.js?buildTime=1735678901`
    - use cached copy directly
  - changed URL:
    - cached `/runtime/js/runner.bundle.js?buildTime=1735678901`
    - request `/runtime/js/runner.bundle.js?buildTime=1735679999`
    - fetch new copy and replace cache entry

- where the version markers come from:
  - many template URLs are written in source as `?buildTime=0`
  - production rsbuild helper rewrites those HTML references to `?sha=...`
  - rsbuild output filenames also carry `?sha=[contenthash:12]`
  - some URLs are hardcoded with a literal `sha=...` in source already
  - so current worker logic needs to treat both `buildTime` and `sha` as version markers
  - but `buildTime=0` is the placeholder / non-versioned case, not a stable asset version

- route buckets:
  - `/_/theme/:asset-name`
  - `/runtime...`
  - app HTML from `serve-app`

- `/_/theme/:asset-name`:
  - returns `X-Anvil-Cacheable`
  - returns `ETag`
  - returns `304` when `If-None-Match` matches app version
  - this is the main ETag-backed path in the current strategy
  - example:
    - first fetch `/_/theme/theme.css` -> `200` + `ETag`
    - later fetch `/_/theme/theme.css` -> worker adds `If-None-Match`
    - server replies `304` or new `200`

- `/runtime...`:
  - wrapped with `wrap-anvil-cacheable`
  - gets `X-Anvil-Cacheable`
  - does not get `ETag` from this code path
  - primary freshness mechanism is versioned URLs (`buildTime`, `sha`)
  - server `Cache-Control` only treats `sha` or `buildTime != 0` as cache-forever
  - `buildTime=0` falls onto `Cache-Control: no-cache, no-store`
  - this is the main startup-performance bucket
  - examples:
    - `/runtime/js/jquery.min.js?buildTime=...`
    - `/runtime/js/skulpt.min.js?buildTime=...`
    - `/runtime/css/bootstrap-theme.min.css?buildTime=...`

- app HTML from `serve-app`:
  - gets `X-Anvil-Cacheable`
  - does not currently emit `ETag`
  - explicit comment says full app response does not yet do "clever ETag things"
  - reason called out there:
    - session token / cookie freshness complicates it

- current strategy, summarized:
  - runtime/static files:
    - cache for performance
    - usually controlled by versioned URLs
  - app theme assets:
    - cache for performance
    - also use ETag revalidation
  - app HTML:
    - cacheable
    - not ETag-driven here

- cache replacement detail:
  - on network response, delete older cache entries for same path with `ignoreSearch: true`
  - then store new response if cacheable
  - so:
    - new `/runtime/js/runner.bundle.js?buildTime=1735679999`
    - can evict old `/runtime/js/runner.bundle.js?buildTime=1735678901`
  - non-cacheable replacement can also flush an older cached copy

- IDE-specific behavior:
  - worker registered with `?inIDE=1`
  - still caches
  - but does not use the `7500ms` timeout shortcut
  - bias is toward freshness during edit/debug sessions

- worked examples:
  - healthy network, runtime asset:
    - request `/runtime/js/skulpt.min.js?buildTime=1735678901`
    - server `200` + `X-Anvil-Cacheable`
    - cache it
    - later same `buildTime` can come straight from cache
  - slow network, cached runtime asset:
    - request `/runtime/js/jquery.min.js?buildTime=1735678901`
    - cached copy exists
    - network takes > `7500ms`
    - return cache immediately
    - continue fetch in background
  - theme asset with ETag:
    - request `/_/theme/theme.css`
    - cached copy has `ETag`
    - worker sends `If-None-Match`
    - server returns `304` or fresh `200`
  - offline with cached app HTML:
    - request `/`
    - cached app HTML exists
    - recent failure marked worker offline
    - return cached HTML

- this whiteboard matches current code if:
  - `sw.js` caches only `GET` + `200` + `X-Anvil-Cacheable`
  - `sw.js` still has the three modes above
  - `sw.js` still uses `sha` / `buildTime` to skip revalidation for versioned URLs
  - `sw.js` still treats `buildTime=0` as not-stably-versioned
  - `sw.js` still copies cached `ETag` into `If-None-Match`
  - `runtime.server/app-routes` still adds `ETag` on `/_/theme/:asset-name`
  - `platform-runtime.util/wrap-anvil-cacheable` still adds `X-Anvil-Cacheable` but not `ETag`
  - `anvil.core.routes/wrap-cache-control` still gives `buildTime=0` the `no-cache, no-store` path
  - `serve-app` still marks app HTML cacheable without emitting `ETag`

