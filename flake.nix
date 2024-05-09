{
  description = "Cloud Sandbox Manager";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-23.11";
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
          fzf

          # K8S
          kubectl
          kubernetes-helm
          krew

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

              # Krew plugins
              export PATH="$HOME/.krew/bin:$PATH"
              krew install view-serviceaccount-kubeconfig

              # Choose stack and set environment name
              export SANDBOX_NAME=$(pulumi -C pulumi/sandbox stack ls --json | jq '.[] | .name' -r | fzf)
            '';

            
          };
        };
      }
    );
}
