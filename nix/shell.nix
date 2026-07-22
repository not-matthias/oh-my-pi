# Development shell for working on omp: bun install / test / edit. The bun here
# is the autoPatchelf'd ompBun — fine for everything EXCEPT `--compile` (its
# compiled output segfaults; see nix/omp.nix). To build the linux binary, use
# `nix build .#omp` (runs the unmodified raw bun inside a buildFHSEnv).
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
    echo "Build the linux standalone binary:"
    echo "  nix build .#omp     # → result/bin/omp  (FHS + raw bun --compile)"
  '';
}
