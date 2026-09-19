# Wry Windows teardown backport

`wry/` contains the crates.io Wry 0.55.1 distribution with one
Windows-only source change in `src/webview2/mod.rs`: remove the parent-window subclass
before releasing its boxed WebView2 controller. Releasing that controller can
dispatch nested window messages; retaining the subclass during release lets
those messages access cleared or freed controller data.

The change is backported from the merged upstream fix:

- https://github.com/tauri-apps/wry/pull/1795
- https://github.com/tauri-apps/wry/commit/3fbf592feab29ffb269778a6f5573746a2f25a4a

Original crate SHA-256:
`186f9871daa55fd9c016578b810d149de58367113db7fb72b462d2323ce19514`.
The upstream Apache-2.0 and MIT licenses remain in `wry/`.
One trailing space in upstream `SECURITY.md` is removed for repository diff checks.

Tauri runtime 2.11.4 constrains Wry to the 0.55 series. The upstream fix shipped
in 0.56.1, so a normal dependency update cannot select it for this runtime.
Remove this directory and the Cargo patch when Kiri adopts a compatible Tauri
release that includes the fix. Do not edit the shared Cargo registry cache.

Windows desktop acceptance repeatedly cancels a real countdown by both click
and Escape, then completes recording, pause, resume and stop. Failed runs retain
the crash dump and matching symbols; the passing application must also complete
the existing native video export tests.
