{
  description = "Cloud Sandbox Manager";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    novops.url = "github:novadiscovery/novops";
  };

  outputs = { self, nixpkgs, flake-utils, novops }: 
    flake-utils.lib.eachDefaultSystem (system:
      let  
        pkgs = nixpkgs.legacyPackages.${system}; 
        novopsPkg = novops.packages.${system}.novops;
                
        # List of packages
        deployPackages = with pkgs; [
          # Deployment tools
          novopsPkg
          awscli2
          gnumake
          pulumi
          pulumiPackages.pulumi-language-nodejs
          nodejs-slim
          nodePackages.npm
          ansible
        ];
      in {
        devShells = {
          default = pkgs.mkShell {
            packages = deployPackages;
          };
        };
      }
    );
}
