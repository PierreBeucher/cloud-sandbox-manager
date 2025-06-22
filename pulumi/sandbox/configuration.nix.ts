
export interface NixConfigArgs{
  hostname: string,
  fqdn: string,
  user: string,
  sshPublicKeys?: string[]
  hashedPassword: string, // hash with mkpasswd
  codeServer?: {
    enabled: boolean,
    hashedPassword : string,
  }

  /**
   * ACME config: registration email, server and EAB (External Account Binding) key id and mac key
   * to generate TLS certificate
   */
  acme: {
    email: string,
    server?: string,
    eab?: {
      keyId: string,
      macKey: string,
    }
  }

  /**
   * Caddy config
   */
  caddy?: {
    
    /**
     * Log level, default to INFO
     * See https://caddyserver.com/docs/caddyfile/directives/log#level
     */
    logLevel?: string,
  }
}

export function getConfigurationNix(args: NixConfigArgs): string {

  // Sandbox user with passwordless root and docker access
  const user = args.user

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
      busybox
      vim
      gnupg
      gnumake
      htop
      unzip
      openssl
      jq
      dive
      git
      awscli2
      
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
      sshpass
      
      # Docker
      docker
      docker-compose
      dive

      # K8S
      k9s
      kubectl
      kubernetes-helm
      kind

      # Node & TS
      nodejs_20
      typescript

    ];

    # user with password and docker access
    users.users.${user} = {
      isNormalUser = true;
      description = "Sandbox user";
      home = "/home/${user}";
      extraGroups = [ "networkmanager" "wheel" "docker" ];
      hashedPassword = "${args.hashedPassword}";
      openssh.authorizedKeys.keys = [
        "${(args.sshPublicKeys || []).join('" "')}"
      ];
    };

    # Code Server running for user
    services.code-server = {
      enable = ${args.codeServer?.enabled || false};
      user = "${user}";
      host = "0.0.0.0";
      port = 8099;
      auth = "password";
      hashedPassword = "${args.codeServer?.hashedPassword}";
    };

    # Caddy reverse proxying to Code Server with TLS
    services.caddy = {
      enable = true;

      logFormat = ''
        level ${args.caddy?.logLevel || "INFO"}
      '';
      
      # Main domain for Code Server
      virtualHosts."${args.fqdn}".extraConfig = ''
        # Redirect main hostname on code server
        reverse_proxy http://localhost:8099

        tls {
          issuer acme {
            email ${args.acme.email}
            dir ${args.acme.server || "https://acme-staging-v02.api.letsencrypt.org/directory"}
            ${args.acme.eab ? `eab ${args.acme.eab.keyId} ${args.acme.eab.macKey}` : ""}
          }
        }
      '';

      # Configure port 80 on *.DOMAIN (all sub-domains) to be redirected to 8080
      # to allow ACME challenge outside of Caddy on all subdomains
      # This allow a Traefik container to use port 8080 internally
      # and still use HTTP challenge for subdomains certificate generation
      virtualHosts."http://*\.${args.fqdn}".extraConfig = ''
        reverse_proxy http://localhost:8080
      '';
    };

    # Required for code-server
    nixpkgs.config.permittedInsecurePackages = [
      "nodejs-16.20.0"
    ];

    # Docker
    virtualisation.docker = {
      enable = true;
      enableOnBoot = true;
      liveRestore = false; # true is not compatible with Swarm
    };

    # Bypass an issue causing Docker Compose stack to break some network connectivity
    # to AWS metadata service (and breaks IAM Role impersonation, kubeconfig using IAM role, etc.)
    # See https://github.com/NixOS/nixpkgs/issues/109389
    networking.useNetworkd = true;

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
  
    system.stateVersion = "24.05";
  }`

}