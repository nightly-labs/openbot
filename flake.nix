{
  description = "OpenBot: a local-first multi-agent desktop workspace";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      sources = lib.importJSON ./nix/sources.json;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forEachSystem =
        f:
        lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config.allowUnfreePredicate = pkg: lib.getName pkg == "openbot";
            }
          )
        );
    in
    {
      packages = forEachSystem (pkgs: {
        openbot = pkgs.callPackage ./nix/package.nix { inherit sources; };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.openbot;
      });

      overlays.default = final: _prev: {
        openbot = final.callPackage ./nix/package.nix { inherit sources; };
      };

      formatter = forEachSystem (pkgs: pkgs.nixfmt);
    };
}
