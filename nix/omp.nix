# Build the omp linux-x64 standalone binary with `Bun.build --compile`.
#
# Architecture — three derivations, only the first two touch the network:
#
#   npmDeps     (FOD)   `bun install --frozen-lockfile` → node_modules      (npm)
#   cargoVendor (FOD)   `cargo vendor` for pi-natives → vendored crates      (crates.io)
#   omp         (FHS)   build .node (offline cargo) + gen:* + Bun.build       (no network)
#
# The final `omp` derivation runs inside a buildFHSEnv. The FHS is required
# because `Bun.build({ compile })` embeds the *running* bun's runtime, and any
# patchelf'd bun produces a segfaulting binary (verified). The raw (unpatched)
# bun must run via its native `/lib64/ld-linux-x86-64.so.2` interpreter, which a
# plain nix sandbox does not provide (sandbox-paths = /bin/sh only). The FHS
# supplies /lib64/ld-linux (→ nix glibc), /usr/bin/env (so #!/usr/bin/env shebangs
# in node_modules work without patchShebangs), and a cc/binutils for the cargo
# build's C deps. The FODs still use the autoPatchelf'd ompBun (runs in a plain
# sandbox); only the compile uses the raw bun (ompBun.raw) via the FHS.
{
  lib,
  stdenv,
  stdenvNoCC,
  ompBun,
  fenixToolchain,
  buildFHSEnv,
  git,
  gnutar,
  cacert,
  writeText,
  src,
}:
let
  # ── FOD 1: node_modules from a frozen lockfile (network: npm registry) ──
  # Determinism verified across runs. `--ignore-scripts` skips the root `prepare`
  # hook (gen:tool-views); the build regenerates it explicitly before compiling.
  # Output is a tarball (not a dir): bun's hoisted linker creates relative
  # symlinks node_modules/@oh-my-pi/* → ../../packages/* that dangle when isolated
  # in the store (noBrokenSymlinks rejects them). A tar preserves them verbatim;
  # the omp build extracts it into the source tree where the symlinks resolve.
  npmDeps = stdenvNoCC.mkDerivation {
    name = "omp-node-modules.tar";
    inherit src;
    nativeBuildInputs = [
      ompBun
      git
      cacert
      gnutar
    ];
    buildPhase = ''
      export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
      bun install --frozen-lockfile --ignore-scripts
    '';
    installPhase = ''
      tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
        -cf "$out" node_modules
    '';
    outputHashMode = "flat";
    outputHashAlgo = "sha256";
    outputHash = "sha256-4d29TTo+7kApcaBCYMeBBTg4rj6PO24Gq8bPaVvMrrU=";
  };

  # ── FOD 2: vendored crates.io deps for crates/pi-natives (network: crates.io) ──
  # dontFixup: nixpkgs' patchShebangs would rewrite vendored scripts' shebangs to
  # /nix/store/.../bash, injecting a store-path reference that FODs disallow.
  cargoVendor = stdenvNoCC.mkDerivation {
    name = "omp-cargo-vendor";
    inherit src;
    nativeBuildInputs = [ fenixToolchain ];
    dontFixup = true;
    buildPhase = ''
      export CARGO_HOME="$TMPDIR/cargo"
      cargo vendor \
        --manifest-path crates/pi-natives/Cargo.toml \
        --locked --versioned-dirs vendor/
    '';
    installPhase = ''
      mkdir -p "$out"
      cp -r vendor/. "$out"/
    '';
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-fZy8d7aQwpMv9nMaysBEzCm/jp4C1yDGRoblNHbTzj8=";
  };

  cargoConfig = writeText "cargo-config.toml" ''
    [source.crates-io]
    replace-with = "vendored-sources"

    [source.vendored-sources]
    directory = "${cargoVendor}"
  '';

  # ── buildFHSEnv: provides /lib64/ld-linux (raw bun), /usr/bin/env, cc, cargo ──
  fhs = buildFHSEnv {
    name = "omp-build";
    targetPkgs =
      p: with p; [
        ompBun.raw # raw bun — `--compile` embeds its unmodified runtime
        fenixToolchain # cargo + rustc (nightly-2026-04-29)
        gcc # cc for the cargo build's C deps (pcre2-sys, tree-sitter, …)
        binutils # as, ld, strip (build-native.ts strips the .node)
        glibc
        glibc.dev # libc headers for cc
        pkg-config
        openssl
        pcre2
        git
        nodejs # napi CLI shebang is #!/usr/bin/env node
        gnutar
        coreutils
        findutils
        gnugrep
        which
      ];
    runScript = "bash";
  };

  # ── Final derivation: .node + codegen + Bun.build --compile, inside the FHS ──
  omp = stdenv.mkDerivation (finalAttrs: {
    name = "omp-linux-x64";
    inherit src;

    nativeBuildInputs = [ fhs ];

    buildPhase = ''
      runHook preBuild

      # The entire build runs inside the FHS so the raw bun (needed for a working
      # `--compile`) can run via /lib64/ld-linux, and node_modules' #!/usr/bin/env
      # shebangs resolve via /usr/bin/env — no patchShebangs needed.
      ${fhs}/bin/omp-build -c '
        set -euo pipefail
        cd "$NIX_BUILD_TOP"/source

        # node_modules from the FOD tarball — extracted into the source tree so
        # the workspace symlinks resolve against packages/.
        rm -rf node_modules
        tar -xf ${npmDeps}
        chmod -R u+w node_modules

        # Offline cargo via the vendored crates (project-local config).
        export CARGO_HOME="$TMPDIR"/cargo
        export CARGO_TARGET_DIR="$TMPDIR"/cargo-target
        export CARGO_NET_OFFLINE=true
        # cc-rs: use gcc (nixpkgs gcc is on PATH as /usr/bin/gcc inside the FHS).
        export CC=gcc
        export CXX=g++
        mkdir -p "$CARGO_HOME" .cargo
        cp ${cargoConfig} .cargo/config.toml

        # 1) pi-natives N-API addon → packages/natives/native/pi_natives.linux-x64-baseline.node
        #    CI=1 → --profile ci (release). TARGET_VARIANT=baseline → portable
        #    x86-64-v2 .node matching the bun-linux-x64-baseline compile target.
        #    (CROSS_TARGET is NOT set here — build-native.ts would route through
        #    cargo-zigbuild and skip the baseline RUSTFLAGS; it is step-2 only.)
        export CI=1
        export TARGET_VARIANT=baseline
        ( cd packages/natives && bun run build )

        # 2) gen:stats + gen:tool-views + gen:native (embed .node) + gen:mupdf
        #    + Bun.build --compile (target bun-linux-x64-baseline) → dist/omp-linux-x64.
        #    CROSS_TARGET scoped here only.
        ( cd packages/coding-agent && CROSS_TARGET=linux-x64 bun run build )

        cp packages/coding-agent/dist/omp-linux-x64 "$NIX_BUILD_TOP"/omp-linux-x64
      '

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"/bin
      install -Dm755 "$NIX_BUILD_TOP"/omp-linux-x64 "$out"/bin/omp
      runHook postInstall
    '';

    # The compiled binary links the host glibc (like CI's release artifact) via
    # /lib64/ld-linux — portable to any glibc linux (and NixOS via nix-ld). It is
    # NOT patchelf'd to a nix glibc, so it stays portable. Never strip a
    # bun-compiled binary (its embedded segments must be byte-exact).
    dontAutoPatchelf = true;
    dontStrip = true;

    meta = with lib; {
      description = "omp coding-agent standalone binary (Bun --compile, linux-x64 baseline)";
      homepage = "https://omp.sh";
      mainProgram = "omp";
      platforms = [ "x86_64-linux" ];
    };
  });
in
{
  inherit npmDeps cargoVendor omp;
}
