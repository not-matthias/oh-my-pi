# Build the omp linux-x64 standalone binary with `Bun.build --compile`.
#
# Architecture — three derivations, only the first two touch the network:
#
#   npmDeps    (FOD)   `bun install --frozen-lockfile` → node_modules      (npm)
#   cargoVendor (FOD)  `cargo vendor` for pi-natives → vendored crates      (crates.io)
#   omp        (pure)  build .node (offline cargo) + gen:* + Bun.build       (no network)
#
# The final `omp` derivation is sandboxed and offline: the only network steps
# (npm + crates.io) live in fixed-output derivations whose hashes are pinned.
# The output binary is NOT a FOD, so its own reproducibility is irrelevant.
{
  lib,
  stdenv,
  stdenvNoCC,
  ompBun,
  fenixToolchain,
  pkg-config,
  openssl,
  pcre2,
  git,
  nodejs,
  cacert,
  gnutar,
  writeText,
  src,
}:
let
  # ── FOD 1: node_modules from a frozen lockfile (network: npm registry) ──
  # Determinism verified: two independent `bun install` runs produce identical
  # node_modules NAR hashes. `--ignore-scripts` skips the root `prepare` hook
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
    # Output a tarball, not a directory: bun's hoisted linker creates relative
    # symlinks from node_modules/@oh-my-pi/* → ../../packages/* (the workspace
    # packages). These dangle when node_modules is isolated in the store, which
    # the noBrokenSymlinks hook rejects. A tar preserves the symlinks verbatim
    # (no validation); the omp derivation extracts it into the source tree, where
    # the symlinks resolve against packages/. Deterministic flags → flat hash.
    installPhase = ''
      tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
        -cf "$out" node_modules
    '';
    outputHashMode = "flat";
    outputHashAlgo = "sha256";
    outputHash = "sha256-4d29TTo+7kApcaBCYMeBBTg4rj6PO24Gq8bPaVvMrrU=";
  };

  # ── FOD 2: vendored crates.io deps for crates/pi-natives (network: crates.io) ──
  # `--versioned-dirs` gives stable directory names; the output is just extracted
  # crate tarballs, so the recursive hash is reproducible across runs.
  cargoVendor = stdenvNoCC.mkDerivation {
    name = "omp-cargo-vendor";
    inherit src;
    nativeBuildInputs = [ fenixToolchain ];
    # Vendored crate sources contain shell scripts with shebangs; nixpkgs'
    # patchShebangs fixup would rewrite them to /nix/store/.../bash, injecting a
    # store-path reference that FODs disallow. Skip fixup — the sources are used
    # verbatim by the omp derivation's offline cargo build (which has bash).
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
    outputHash = "sha256-fZy8d7aQwpMv9nMaysBEzCm/jp4C1yDGRoblNHbTzj8=";
  };

  # Cargo config pointing at the vendored crates (absolute store path → offline).
  cargoConfig = writeText "cargo-config.toml" ''
    [source.crates-io]
    replace-with = "vendored-sources"

    [source.vendored-sources]
    directory = "${cargoVendor}"
  '';

  # ── Final pure derivation: .node + codegen + Bun.build --compile ──
  omp = stdenv.mkDerivation (finalAttrs: {
    name = "omp-linux-x64";
    inherit src;

    nativeBuildInputs = [
      ompBun
      fenixToolchain
      pkg-config
      openssl
      pcre2
      git
      nodejs
    ];

    env = {
      CARGO_NET_OFFLINE = "true";
      # build-native.ts honors CI=1 → `--profile ci` (release, like the release
      # artifacts) and TARGET_VARIANT=baseline → a portable x86-64-v2 .node that
      # matches the bun-linux-x64-baseline compile target. build-native.ts sets
      # PCRE2_SYS_STATIC=1 itself.
      CI = "1";
      TARGET_VARIANT = "baseline";
      # CROSS_TARGET is NOT set here: build-native.ts routes through
      # cargo-zigbuild when CROSS_TARGET is set (and skips the baseline
      # RUSTFLAGS). It is scoped to step 2 only (the codegen + compile).
    };

    buildPhase = ''
      runHook preBuild

      # Extract node_modules from the FOD tarball into the source tree, so the
      # workspace symlinks resolve against packages/. (patches applied in FOD.)
      rm -rf node_modules
      tar -xf ${npmDeps}
      chmod -R u+w node_modules
      # node_modules .bin scripts use `#!/usr/bin/env {node,bun}` shebangs, which
      # fail in the sandbox (/usr/bin/env is unavailable). Rewrite them to the
      # absolute nix interpreters (node from nodejs, bun from ompBun) in PATH.
      patchShebangs node_modules

      # Wire cargo to the vendored crates (no network in this derivation).
      # CARGO_HOME/CARGO_TARGET_DIR are exported here, NOT via `env` — nixpkgs'
      # `env` sets literal strings without expanding $TMPDIR, which broke the
      # config path. The vendor config goes in a project-local .cargo/config.toml
      # (the location `cargo vendor` recommends), which cargo reads regardless of
      # CARGO_HOME.
      export CARGO_HOME="$TMPDIR/cargo"
      export CARGO_TARGET_DIR="$TMPDIR/cargo-target"
      mkdir -p "$CARGO_HOME" .cargo
      cp ${cargoConfig} .cargo/config.toml

      # 1) pi-natives N-API addon → packages/natives/native/pi_natives.linux-x64-baseline.node
      ( cd packages/natives && bun run build )

      # 2) gen:stats + gen:tool-views + gen:native (embed .node) + gen:mupdf
      #    + Bun.build --compile (target bun-linux-x64-baseline) → dist/omp-linux-x64.
      #    CROSS_TARGET is scoped HERE ONLY — step 1 must not see it (see env note).
      ( cd packages/coding-agent && CROSS_TARGET=linux-x64 bun run build )
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"/bin
      install -Dm755 packages/coding-agent/dist/omp-linux-x64 "$out"/bin/omp
      runHook postInstall
    '';

    # The compiled binary links against the host glibc (like CI's release
    # artifact) and is meant to run on any glibc linux — it is NOT patchelf'd
    # to a nix glibc, so it stays portable.
    dontAutoPatchelf = true;
    dontStrip = true;

    meta = with lib; {
      description = "omp coding-agent standalone binary (Bun --compile, linux-x64 baseline)";
      homepage = "https://omp.sh";
      mainProgram = "omp";
      platforms = [ "x86_64-linux" ];
    };
  });
in { inherit npmDeps cargoVendor omp; }
