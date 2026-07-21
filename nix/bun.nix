# Bun 1.3.14 prebuilt runtime.
#
# nixpkgs only ships 1.3.13, but omp pins `packageManager: bun@1.3.14` and the
# coding-agent enforces `engines.bun >= 1.3.14`. The prebuilt release binary is
# used directly (fetched + autoPatchelf'd) rather than building bun from source.
{
  lib,
  stdenv,
  fetchurl,
  unzip,
  autoPatchelfHook,
  glibc,
}:
let
  # One asset per host triple. For x86_64 we use the *baseline* build
  # (x86-64-v2): the omp binary is compiled with `--target bun-linux-x64-baseline`,
  # and Bun's `--compile` fetches the target runtime slice over the network when
  # the host bun's slice differs from the compile target. Shipping the baseline
  # bun makes host-target == compile-target, so the sandboxed compile stays
  # offline (verified: zero network connects). Baseline runs on any x86-64.
  # aarch64 has no baseline/modern split — a single asset covers it.
  sources = {
    x86_64-linux = {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64-baseline.zip";
      hash = "sha256-oGOQiuCLeFLKEJObvcbO7T3avOj7lALc6D1l1zs25sc=";
    };
    aarch64-linux = {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-aarch64.zip";
      hash = "sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs=";
    };
  };
  src = sources.${stdenv.hostPlatform.system} or (throw "omp-bun: no prebuilt asset for ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation {
  pname = "omp-bun";
  version = "1.3.14";

  src = fetchurl {
    inherit (src) url hash;
  };

  # The prebuilt ELF only links against glibc (libc/ld/libpthread/libdl/libm);
  # autoPatchelf rewires the interpreter + rpath to the nix glibc.
  nativeBuildInputs = [
    unzip
    autoPatchelfHook
  ];
  buildInputs = [ glibc ];

  sourceRoot = ".";

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    install -Dm755 bun-*/bun $out/bin/bun
    runHook postInstall
  '';

  # `bun --compile` reads BUN_BE_BUN; the prebuilt is fine without it.
  passthru = {
    # Expose the runtime path for derivations that need to invoke `bun`.
    executable = "${placeholder "out"}/bin/bun";
  };

  meta = with lib; {
    description = "Bun JavaScript runtime (1.3.14, prebuilt) — pinned by omp";
    homepage = "https://bun.sh";
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
    license = licenses.mit;
    platforms = builtins.attrNames sources;
    mainProgram = "bun";
  };
}
