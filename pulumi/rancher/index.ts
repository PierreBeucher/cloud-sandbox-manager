import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { getKubernetesProvider, getPulumiStackRef } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")
const fqdn = config.require("fqdn")

// Get ClusterIssuer from cert-manager stack
const certManagerStack = getPulumiStackRef({ name: "cloud-sandbox-cert-manager", environment: environment })
const clusterIssuerName = certManagerStack.getOutput("clusterIssuerName") as pulumi.Output<string>

const k8sProvider = getKubernetesProvider()

const commonTags = { 
    Name: `cloud-sandbox-${environment}-rancher`,
}

// Rancher namespace
const rancherNamespaceName = "cattle-system"
const rancherNamespace = new k8s.core.v1.Namespace("rancher-namespace", {
    metadata: {
        name: rancherNamespaceName
    }
}, {
    provider: k8sProvider
})

// Rancher Helm chart release
const rancherRelease = new k8s.helm.v3.Release("rancher", {
    name: "rancher",
    chart: "rancher",
    version: "2.13.2",
    repositoryOpts: {
        repo: "https://releases.rancher.com/server-charts/stable",
    },
    namespace: rancherNamespaceName,
    values: {
        hostname: fqdn,
        replicas: 1,
        ingress: {
            enabled: true,
            ingressClassName: "traefik",

            // override Ingress annotations to use our own Cert Manager ClusterIssuer
            extraAnnotations: clusterIssuerName.apply(issuerName => ({
                "cert-manager.io/issuer-kind": "ClusterIssuer",
                "cert-manager.io/issuer": issuerName,
            }))
        },
        tls: "ingress",
        bootstrapPassword: "Docker2026!",
    },
}, {
    provider: k8sProvider,
    deleteBeforeReplace: true,
    dependsOn: [rancherNamespace]
})

export const namespaceName = rancherNamespaceName
export const releaseName = rancherRelease.name
