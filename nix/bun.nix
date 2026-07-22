# Bun 1.3.14 prebuilt runtime.
#
# nixpkgs only ships 1.3.13, but omp pins `packageManager: bun@1.3.14` and the
# coding-agent enforces `engines.bun >= 1.3.14`. We fetch the prebuilt release.
#
# Two derivations are needed because of a bun `--compile` limitation:
#   • `Bun.build({ compile })` embeds the *running* bun's ELF runtime. If the
#     bun binary has been patchelf'd (interpreter/rpath rewritten), the embedded
#     runtime is corrupted and the compiled output segfaults at entry. bun must
#     run UNMODIFIED via its native `/lib64/ld-linux` interpreter for `--compile`
#     to produce a working binary (verified).
#   • But the raw (unmodified) bun needs `/lib64/ld-linux-x86-64.so.2`, which a
#     plain nix sandbox does NOT provide (sandbox-paths only has /bin/sh).
#
# So:
#   `rawBun`  — unmodified ELF, interpreter /lib64/ld-linux-x86-64.so.2. Used for
#               `--compile`, run inside a buildFHSEnv (which provides /lib64/ld-linux)
#               or on a host with nix-ld.
#   `ompBun`  — rawBun + autoPatchelf (nix glibc interpreter + rpath). Runs in a
#               plain sandbox; used for `bun install` in the FODs. Its `--compile`
#               output is BROKEN — never use it to compile binaries.
{
  lib,
  stdenv,
  stdenvNoCC,
  fetchurl,
  unzip,
  autoPatchelfHook,
  glibc,
}:
let
  # x86_64 uses the baseline build (x86-64-v2): the omp binary compiles with
  # `--target bun-linux-x64-baseline`, and bun's `--compile` fetches the target
  # runtime slice over the network when the host bun's slice differs. Shipping
  # the baseline bun makes host-target == compile-target → offline compile.
  # Baseline runs on any x86-64; aarch64 has no baseline/modern split.
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
  srcAsset = fetchurl (sources.${stdenv.hostPlatform.system} or (throw "omp-bun: no prebuilt asset for ${stdenv.hostPlatform.system}"));

  # Unmodified bun ELF. dontFixup so no patchShebangs/strip touches it.
  rawBun = stdenvNoCC.mkDerivation {
    name = "omp-bun-raw-1.3.14";
    src = srcAsset;
    nativeBuildInputs = [ unzip ];
    sourceRoot = ".";
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"/bin
      install -Dm755 bun-*/bun "$out"/bin/bun
      runHook postInstall
    '';
  };
in
# autoPatchelf'd bun (nix glibc interpreter + rpath) for plain-sandbox use.
stdenv.mkDerivation {
  pname = "omp-bun";
  version = "1.3.14";
  src = rawBun;

  nativeBuildInputs = [ autoPatchelfHook ];
  buildInputs = [ glibc ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"/bin
    cp bin/bun "$out"/bin/bun
    chmod +x "$out"/bin/bun
    runHook postInstall
  '';

  passthru = {
    # The unmodified bun for `--compile` (run inside buildFHSEnv, not the sandbox).
    raw = rawBun;
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
