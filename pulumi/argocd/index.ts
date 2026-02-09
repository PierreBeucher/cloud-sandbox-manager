import * as pulumi from "@pulumi/pulumi"
import * as kubernetes from "@pulumi/kubernetes"
import { getKubernetesProvider, getPulumiStackRef } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")
const fqdn = config.require("fqdn")
const adminPasswordHash = config.require("adminPasswordHash")

const k8sProvider = getKubernetesProvider()

// use ClusterIssuer from cert-manager stack
const certManagerStack = getPulumiStackRef({ name: "cloud-sandbox-cert-manager", environment: environment })
const clusterIssuerName = certManagerStack.getOutput("clusterIssuerName") as pulumi.Output<string>

pulumi.all([clusterIssuerName]).apply(([clusterIssuerName]) => {
    console.log(`Cluster issuer name: ${clusterIssuerName}`)
})

const argocdNamespace = new kubernetes.core.v1.Namespace("argocdNamespace", {
    metadata: { name: "argocd" }
}, {
    provider: k8sProvider
})

// ArgoCD Certificate using cert-manager
const secretName = "argocd-tls"
const argocdCertificate = new kubernetes.apiextensions.CustomResource("argocd-certificate", {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
        name: "web-ui-certificate",
        namespace: argocdNamespace.metadata.name,
    },
    spec: {
        secretName,
        issuerRef: {
            name: clusterIssuerName,
            kind: "ClusterIssuer"
        },
        dnsNames: [
            fqdn
        ]
    }
}, {
    provider: k8sProvider
})

// Traefik middleware to redirect HTTP to HTTPS
const httpsRedirectMiddleware = new kubernetes.apiextensions.CustomResource("https-redirect-middleware", {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
        name: "https-redirect",
        namespace: argocdNamespace.metadata.name,
    },
    spec: {
        redirectScheme: {
            scheme: "https",
            permanent: true
        }
    }
}, {
    provider: k8sProvider
})

const argocdRelease = new kubernetes.helm.v3.Release(`helm-chart-argocd`, {
    name: "argocd",
    chart: "argo-cd",
    values: {
        global: {
            domain: fqdn,
        },
        configs: {
            secret: {
                argocdServerAdminPassword: adminPasswordHash,
            },
            params: {
                // terminate TLS at ingress controller level
                "server.insecure": true,

                // Argo watches all namespaces for Apps
                "application.namespaces": "*",
            }
        },
        server: {
            ingress: {
                enabled: true,
                annotations: {
                    "kubernetes.io/ingress.class": "traefik",

                    // Traefik middleware to redirect HTTP to HTTPS
                    "traefik.ingress.kubernetes.io/router.middlewares": 
                        pulumi.interpolate`${argocdNamespace.metadata.name}-https-redirect@kubernetescrd`,
                },
                hosts: [fqdn],
                extraTls: [{
                    hosts: [fqdn],
                    secretName: secretName
                }]
            }
        }
    },
    version: "8.3.5",
    namespace: argocdNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://argoproj.github.io/argo-helm",
    },
}, {
    provider: k8sProvider
})

// AppProject for sandbox, like the default AppProject but allowing any sourceNamespace and sourceRepo
// DON'T USE THIS IN PRODUCTION as ArgoCD would sync any app from any namespace and source
// this is for sandbox environment only
const sandboxAppProject = new kubernetes.apiextensions.CustomResource("sandbox-appproject", {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "AppProject",
    metadata: {
        name: "sandbox",
        namespace: argocdNamespace.metadata.name,
    },
    spec: {
        clusterResourceWhitelist: [
            {
                group: "*",
                kind: "*"
            }
        ],
        destinations: [
            {
                namespace: "*",
                server: "*"
            }
        ],
        sourceNamespaces: ["*"],
        sourceRepos: ["*"]
    }
}, {
    provider: k8sProvider,
    dependsOn: [argocdRelease]
})

