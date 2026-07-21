# Development shell with everything needed to build the omp linux binary
# interactively: `nix develop` then
#   bun install --frozen-lockfile
#   bun --cwd=packages/natives run build      # compiles the pi-natives .node
#   bun --cwd=packages/coding-agent run build # gen:* + Bun.build --compile
{
  lib,
  stdenv,
  mkShell,
  ompBun,
  fenixToolchain,
  pkg-config,
  openssl,
  pcre2,
  git,
  nodejs,
  gnumake,
  python3,
  cacert,
}:
mkShell {
  # The prebuilt bun 1.3.14 (nixpkgs' 1.3.13 is rejected by engines.bun).
  packages = [
    ompBun
    # Nightly toolchain pinned by rust-toolchain.toml (nightly-2026-04-29).
    fenixToolchain
    pkg-config
    openssl
    pcre2
    git
    nodejs
    gnumake
    python3
  ];

  # build-native.ts sets PCRE2_SYS_STATIC=1 itself; surface it here so a manual
  # `cargo build` of crates/pi-natives also links pcre2 statically.
  env.PCRE2_SYS_STATIC = "1";

  shellHook = ''
    echo "omp dev shell"
    echo "  bun       $(bun --version 2>/dev/null || echo 'not found')"
    echo "  cargo     $(cargo --version 2>/dev/null || echo 'not found')"
    echo ""
    echo "Build the linux binary:"
    echo "  bun install --frozen-lockfile"
    echo "  bun --cwd=packages/natives run build"
    echo "  CROSS_TARGET=linux-x64 CI=1 bun --cwd=packages/coding-agent run build"
    echo "  → packages/coding-agent/dist/omp"
  '';
}
