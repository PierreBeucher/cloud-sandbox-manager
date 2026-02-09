import * as pulumi from "@pulumi/pulumi"
import * as kubernetes from "@pulumi/kubernetes"
import { getKubernetesProvider } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")

// ACME configuration
const acmeEmail = config.require("acmeEmail")
const clusterIssuerAcmeFlavor = config.get("clusterIssuerAcmeFlavor") ?? "letsencrypt"
const acmeEabKeyId = config.get("acmeEabKeyId")
const acmeEabMacKey = config.get("acmeEabMacKey")

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

// Define ACME config based on flavor
const baseClusterIssuerName = "cluster-issuer"

// ACME spec adapted depending on the ACME flavor
let acmeSpec: {
    email: pulumi.Input<string>
    privateKeySecretRef: {
        name: pulumi.Input<string>
    }
    server?: pulumi.Input<string>
    solvers: pulumi.Input<{
        http01: {
            ingress: {
                class: pulumi.Input<string>
            }
        }
    }[]>
    externalAccountBinding?: {
        keyID: pulumi.Input<string>
        keySecretRef: {
            name: pulumi.Input<string>
            key: pulumi.Input<string>
        }
    }
} = {
    email: acmeEmail,
    privateKeySecretRef: {
        name: "certmanager-acme-private-key"
    },
    solvers: [
        { http01: { ingress: { class: "traefik" } } }
    ]
}

if (clusterIssuerAcmeFlavor === "zerossl") {
    if (!acmeEabKeyId || !acmeEabMacKey) {
        throw new Error("Both acmeEabKeyId and acmeEabMacKey must be provided when using ZeroSSL")
    }

    const eabMacKeySecret = new kubernetes.core.v1.Secret("cert-manager-eab-mac-key", {
        metadata: {
            name: "cert-manager-eab-mac-key",
            namespace: certmanagerNamespace.metadata.name,
        },
        stringData: {
            macKey: acmeEabMacKey,
        },
    }, {
        provider: k8sProvider,
        dependsOn: [certManagerRelease],
    })

    acmeSpec.server = "https://acme.zerossl.com/v2/DV90"
    acmeSpec.externalAccountBinding = {
        keyID: acmeEabKeyId,
        keySecretRef: {
            name: eabMacKeySecret.metadata.name,
            key: "macKey"
        }
    }
    

} else if (clusterIssuerAcmeFlavor === "letsencrypt") {

    // Let's Encrypt use staging server
    acmeSpec.server = "https://acme-v02.api.letsencrypt.org/directory"

    // Additional production ClusterIssuer for Let's Encrypt (default issuer uses staging server)
    const clusterCertIssuerProd = new kubernetes.apiextensions.CustomResource("cert-manager-cluster-issuer-prod", {
        apiVersion: "cert-manager.io/v1",
        kind: "ClusterIssuer",
        metadata: {
            name: `${baseClusterIssuerName}-prod`,
            namespace: certmanagerNamespace.metadata.name,
        },
        spec: {
            acme: {
                ...acmeSpec,
                server: "https://acme-v02.api.letsencrypt.org/directory",
            }
        }
    }, {
        dependsOn: [certManagerRelease],
        provider: k8sProvider
    })
} else {
    throw new Error(`Invalid clusterIssuerAcmeFlavor: ${clusterIssuerAcmeFlavor}. Must be "letsencrypt" or "zerossl"`)
}

const clusterCertIssuer = new kubernetes.apiextensions.CustomResource("cert-manager-cluster-issuer", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: baseClusterIssuerName,
        namespace: certmanagerNamespace.metadata.name,
    },
    spec: {
        acme: acmeSpec
    }
}, {
    dependsOn: [certManagerRelease],
    provider: k8sProvider
})


export const clusterIssuerName = baseClusterIssuerName
