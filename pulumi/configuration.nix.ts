
export interface NixConfigArgs{
  hostname: string
  password: string,
}

export function getConfigurationNix(args: NixConfigArgs): string {

  // Sandbox user with passwordless root and docker access
  const user = "linux"

  return `
    { modulesPath, config, pkgs, ... }: {
    
    imports = [ 
      "\${modulesPath}/virtualisation/amazon-image.nix" # NixOS built-in config for AWS, do not remove
    ];
    ec2.hvm = true;

    nixpkgs.config.allowUnfree = true;

    networking.hostName = "${args.hostname}";

    # OS packages
    environment.systemPackages = with pkgs; [
      
      # Misc
      gnupg
      gnumake
      htop
      unzip
      openssl
      jq
      dive
      git
      
      # Python and packages (used by Ansible for post-deploy config and tests)
      (python310.withPackages(ps: with ps; [
        pip
        docker
        docker-compose # this does not fail on rebuild but does not provide "compose" Python module :(
        pyyaml
      ]))

      # Network
      bind 
      traceroute
      
      # Docker
      docker
      docker-compose
      dive
    ];

    # user with password and docker access
    users.users.${user} = {
      isNormalUser = true;
      description = "Sandbox user";
      home = "/home/${user}";
      extraGroups = [ "networkmanager" "wheel" "docker" ];
      initialPassword = "${args.password}";
    };

    # Code Server running for user
    services.code-server = {
      enable = true;
      user = "${user}";
      host = "0.0.0.0";
      port = 8080;
      auth = "password";
      # Hash for "Docker2023!"
      # Hashed password with echo -n <password> | argon2 <salt> -e
      hashedPassword = "$argon2i$v=19$m=4096,t=3,p=1$OGJzemtrN0NWdVVERHV5ZXJ5ODZaWnVrNFZkTnBrYU5xand0Wg$N745mNrRadI2E/o7Q4SB7F5SEQDxH6nNo96dRWrXNE8";
    }; 

    # Docker
    virtualisation.docker = {
      enable = true;
      enableOnBoot = true;
    };

    # Allow passwordless sudo
    security.sudo.extraRules= [
      {  users = [ "${user}" ];
        commands = [
          { command = "ALL" ;
            options= [ "NOPASSWD" ]; # "SETENV" # Adding the following could be a good idea
          }
        ];
      }
    ];

    # Allow all ports as we're in a sandbox environment
    networking.firewall = {
      # enable = true;
      allowedTCPPortRanges = [ { from = 0; to = 65535; } ];
      allowedUDPPortRanges = [ { from = 0; to = 65535; } ];
    };

    # Generous swap
    swapDevices = [ {
      device = "/var/lib/swapfile";
      size = 4*1024;
    } ];
  
    system.stateVersion = "22.11";
  }`

}