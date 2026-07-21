{
  description = "oh-my-pi — build the omp linux binary via Bun --compile";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    { self, nixpkgs, fenix, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);

      # Hash of the dated nightly manifest (channel-rust-nightly.toml) for
      # 2026-04-29. fenix's fromToolchainFile fetches this manifest by hash,
      # then resolves per-component hashes from it — no further user input.
      # pi-natives requires nightly (`#![feature(alloc_error_hook)]`).
      rustManifestHash = "sha256-2P4pDcIBOuql6SViiqWSn1niY+SURPC7Y35w6iybHdo=";

      toolchainFor =
        system:
        fenix.packages.${system}.fromToolchainFile {
          file = ./rust-toolchain.toml;
          sha256 = rustManifestHash;
        };
    in
    {
      overlays.default = final: prev: {
        ompBun = final.callPackage ./nix/bun.nix { };
      };

      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ self.overlays.default ];
          };
          fenixToolchain = toolchainFor system;
          ompPkgs = pkgs.callPackage ./nix/omp.nix {
            inherit fenixToolchain;
            src = self;
          };
        in
        {
          # Bun 1.3.14 (baseline for x86_64) — nixpkgs only ships 1.3.13.
          bun = pkgs.ompBun;
          # The two fixed-output derivations (network: npm + crates.io). Exposed
          # so they can be built/verified in isolation: `nix build .#omp-npm-deps`.
          omp-npm-deps = ompPkgs.npmDeps;
          omp-cargo-vendor = ompPkgs.cargoVendor;
          # The omp linux-x64 standalone binary (pure build: see nix/omp.nix).
          omp = ompPkgs.omp;
          default = ompPkgs.omp;
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ self.overlays.default ];
          };
          fenixToolchain = toolchainFor system;
        in
        {
          default = pkgs.callPackage ./nix/shell.nix {
            inherit fenixToolchain;
          };
        }
      );
    };
}
