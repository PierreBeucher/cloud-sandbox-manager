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
          sshpass # for Ansible with SSH password

          # Utils
          libargon2 # Used to hash password for code-server
          go # for Terratest
        ];
      in {
        devShells = {
          default = pkgs.mkShell {
            packages = deployPackages;

            shellHook = ''
              export PULUMI_SKIP_UPDATE_CHECK=1
            '';
          };
        };
      }
    );
}
