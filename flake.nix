{
  description = "Cloud Sandbox Manager";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
    novops.url = "github:PierreBeucher/novops";
  };

  outputs = { self, nixpkgs, flake-utils, novops }: 
    flake-utils.lib.eachDefaultSystem (system:
      let  
        pkgs = nixpkgs.legacyPackages.${system}; 
        novopsPkg = novops.packages.${system}.novops;
                
        deployPackages = with pkgs; [
          # Deployment tools
          awscli2
          gnumake
          pulumi-bin
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
          go-task # Taskfile
        ];
      in {
        devShells = {
          default = pkgs.mkShell {
            packages = deployPackages;

            shellHook = ''
              export PULUMI_SKIP_UPDATE_CHECK=1
              export PULUMI_K8S_DELETE_UNREACHABLE=true

              # Krew plugins
              export PATH="$HOME/.krew/bin:$PATH"
              krew install view-serviceaccount-kubeconfig

              # Choose stack and set environment name
              source <(novops load)

              PS1="($SANDBOX_ENVIRONMENT) $PS1"
            '';

            
          };
        };
      }
    );
}
