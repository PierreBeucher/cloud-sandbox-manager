# AGENTS.md

Guidance for AI agents working on this repository.

## Project summary

Cloud Sandbox Manager deploys disposable sandbox environments on AWS for training sessions
(Docker, Kubernetes, Ansible...):

- **Sandbox EC2 instances** running NixOS: Docker, code-server (port 8099), SSH, per-user
  domain names such as `alice.training.crafteo.io`
- **An EKS cluster** with training tooling: Traefik ingress (`*.k8s.crafteo.io` → ALB),
  cert-manager with a ZeroSSL ClusterIssuer (`cluster-issuer`), ArgoCD, Rancher,
  Metrics Server, Cluster Autoscaler

Infrastructure is defined with **Pulumi** (TypeScript), orchestrated with **go-task**,
and every tool runs inside a **Nix flake dev shell**.

👉 **Read `README.md` first** for high-level usage, deployment and maintenance docs.

## Development and Nix Flake

All binaries are available via Nix Flake, see `flake.nix`. If you already run under the proper Nix flake, nothing to do. Otherwise every development commands (Pulumi, tasks, etc.) must be run under a Nix dev sgell, eg `nix develop -c task docker`

## Environment rules

- **ALL commands must run in the Nix dev shell.** Prefix non-interactive commands with
  `nix develop -c <cmd>` (an interactive session uses `nix develop`).
- Non-interactive shells **must** set `NOVOPS_ENVIRONMENT=crafteo` (or `ami-template`):
  Novops loads `SANDBOX_ENVIRONMENT` and AWS config in the shellHook. Without it,
  `novops load` tries to prompt on a terminal and fails.
- `SANDBOX_ENVIRONMENT` is the Pulumi stack name used by every task. For the `crafteo`
  environment everything (EC2 sandbox + EKS) is on stack `crafteo`.
- AWS credentials and Pulumi (app.pulumi.com) auth come from the environment/machine.
  Sanity check with `aws sts get-caller-identity` and `pulumi stack ls`.

## Key paths

| Path | Purpose |
|---|---|
| `Taskfile.yml` | All orchestration tasks (deploy, tests, destroy) |
| `pulumi/sandbox/` | Sandbox EC2 instances stack; NixOS config generator in `configuration.nix.ts` |
| `pulumi/eks/` | EKS cluster, VPC, nodegroups (Kubernetes version set here) |
| `pulumi/eks-config/` | Post-cluster config: EBS CSI driver, storage class, `sandbox-sa` |
| `pulumi/cert-manager/` | cert-manager + ACME ClusterIssuer (ZeroSSL by default, name `cluster-issuer`) |
| `pulumi/traefik/` | Traefik ingress controller + Route53 wildcard `*.<zone>` records |
| `pulumi/argocd/` | ArgoCD (`argocd.<zone>`) |
| `pulumi/rancher/` | Rancher (`rancher.<zone>`) |
| `pulumi/cluster-autoscaler/`, `pulumi/metrics-server/` | K8S addons |
| `pulumi/components/service-account.ts` | Shared ServiceAccount component |
| `pulumi/utils.ts` | `getKubernetesProvider()`, `getPulumiStackRef()` helpers |
| `ansible/` | NixOS provisioning + kubeconfig playbooks; inventories in `ansible/inventories/` are **generated** from Pulumi outputs |
| `test/` | `test-docker.yml`, `test-eks.yml` (run via `task test-docker` / `task test-eks`) |
| `flake.nix`, `.novops.yml` | Dev shell definition, environment variables |
| `scripts/create-ami.sh` | Build the custom NixOS base AMI (run via `task ami-template`) |

## Main workflows

```sh
# Enter dev shell (interactive)
nix develop

# Deploy sandbox EC2 instances + configure them via Ansible
task docker

# Deploy EKS cluster + all K8S tooling
# (eks → cluster-autoscaler → traefik → cert-manager → metrics-server → argocd → rancher → kubeconfig)
task k8s-all

# Tests
task test-docker   # EVAP compose stack, ELK, Prometheus — plain HTTP, non-standard ports
task test-eks      # cluster access, hello-world TLS workload, ArgoCD/Rancher pings

# Start/stop everything (cost saving)
task stop-all / task start-all

# Undeploy everything (EC2, EKS, K8S tooling)
task destroy-all
```

## Stack dependency order

1. `sandbox` (EC2 instances) — must exist first: other stacks' Ansible steps use its inventory
2. `eks` → `eks-config` (cluster + addons)
3. K8S tooling stacks (`traefik`, `cert-manager`, `metrics-server`, `cluster-autoscaler`,
   `argocd`, `rancher`) — all build a Kubernetes provider from the `eks` stack `kubeconfig`
   output via `getKubernetesProvider()`

On a fresh environment run `task docker` **before** `task k8s-all`
(`k8s-all` runs `ansible-eks` against the sandbox inventory).

## Conventions & gotchas

- **Version bumps**: see README "Version bumps and updates" for the checklist and file paths.
  Check latest chart versions with `helm search repo <repo>/<chart> --versions` before bumping.
  When bumping EKS, verify chart compatibility first (Rancher chart pins `kubeVersion`).
- **`Pulumi.<env>.yaml` files are gitignored** (only `Pulumi.template.yaml` is tracked):
  environment configs are local.
- **Sandbox TLS architecture**: host Caddy terminates 80/443 (ZeroSSL for the main host),
  proxies HTTP wildcard to Docker Traefik. Docker tests skip TLS checks (tagged `never`,
  re-enable with `--tags traefik`) — plain HTTP on non-standard ports only.
- **Ansible inventories are generated**, do not hand-edit: `task ansible-inventory` writes
  them from Pulumi stack outputs.
- **Instance SSH**: `root@<ip>` for admin (e.g. debugging NixOS), `docker@<ip>` is the
  sandbox user used by Ansible/tests.
- Helm chart versions live as string literals in each stack's `index.ts`
  (`version: "x.y.z"`).
