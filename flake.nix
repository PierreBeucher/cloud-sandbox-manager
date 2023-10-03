{
  description = "Cloud Sandbox Manager";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }: 
    flake-utils.lib.eachDefaultSystem (system:
      let  
        pkgs = nixpkgs.legacyPackages.${system}; 
                
        deployPackages = with pkgs; [
          # Deployment tools
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
