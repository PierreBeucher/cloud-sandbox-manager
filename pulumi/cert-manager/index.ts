import * as pulumi from "@pulumi/pulumi"
import * as kubernetes from "@pulumi/kubernetes"
import { getKubernetesProvider } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")

const k8sProvider = getKubernetesProvider()

const certmanagerNamespace = new kubernetes.core.v1.Namespace("certmanagerNamespace", {
    metadata: { name: "cert-manager" }
}, {
    provider: k8sProvider
})

const certManagerRelease = new kubernetes.helm.v3.Release(`helm-chart-cert-manager`, {
    name: "cert-manager",
    chart: "cert-manager",
    values: {
        installCRDs: true
    },
    version: "1.18.2",
    namespace: certmanagerNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://charts.jetstack.io",
    },
}, {
    provider: k8sProvider
})

const stagingClusterCertIssuer = new kubernetes.apiextensions.CustomResource("cert-manager-cluster-issuer", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "cluster-issuer",
        namespace: certmanagerNamespace.metadata.name,
    },
    spec: {
        acme: {
            email: "kubernetes-training@crafteo.io",
            server: "https://acme-staging-v02.api.letsencrypt.org/directory",
            privateKeySecretRef: {
                name: "certmanager-acme-private-key"
            },
            solvers: [
                { http01: { ingress: { class: "traefik" } } }
            ]
        }
    }
}, {
    dependsOn: [certManagerRelease],
    provider: k8sProvider
})

const clusterCertIssuerProd = new kubernetes.apiextensions.CustomResource("cert-manager-cluster-issuer-prod", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "cluster-issuer-prod",
        namespace: certmanagerNamespace.metadata.name,
    },
    spec: {
        acme: {
            email: "kubernetes-training@crafteo.io",
            server: "https://acme-v02.api.letsencrypt.org/directory",
            privateKeySecretRef: {
                name: "certmanager-acme-private-key"
            },
            solvers: [
                { http01: { ingress: { class: "traefik" } } }
            ]
        }
    }
}, {
    dependsOn: [certManagerRelease],
    provider: k8sProvider
})

export const stagingClusterIssuerName = stagingClusterCertIssuer.metadata.name
export const prodClusterIssuerName = clusterCertIssuerProd.metadata.name