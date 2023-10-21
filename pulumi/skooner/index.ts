import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { getKubernetesProvider } from "../utils"
import { ServiceAccount } from "../components/service-account"

const config = new pulumi.Config();
const environment = config.require("environment")
const fqdn = config.require("fqdn")

const k8sProvider = getKubernetesProvider()

const commonTags = { 
    Name: `cloud-sandbox-${environment}`,
}

const commonOpts = {
    provider: k8sProvider
}

const skoonerNamespace = new k8s.core.v1.Namespace("skooner-namespace", {
    metadata: {
     
        name: "skooner"
    }
}, commonOpts)

const skoonerDeploy = new k8s.apps.v1.Deployment("skooner-deployment", {
    "metadata": {
        "name": "skooner",
        "namespace": skoonerNamespace.metadata.name
    },
    "spec": {
        "selector": {
            "matchLabels": {
                "k8s-app": "skooner"
            }
        },
        "template": {
            "metadata": {
                "labels": {
                    "k8s-app": "skooner"
                }
            },
            "spec": {
                "containers": [
                    {
                        "image": "ghcr.io/skooner-k8s/skooner:stable",
                        "livenessProbe": {
                            "httpGet": {
                                "path": "/",
                                "port": 4654,
                                "scheme": "HTTP"
                            }
                        },
                        "name": "skooner",
                        "ports": [{
                            "containerPort": 4654,
                            "protocol": "TCP"
                        }],
                    }
                ],
                "nodeSelector": {
                    "kubernetes.io/os": "linux"
                },
            }
        }
    },
}, {
    ...commonOpts,
    dependsOn: skoonerNamespace,
});

const skoonerService = new k8s.core.v1.Service("skooner-service", {
    "metadata": {
        "name": "skooner",
        "namespace": skoonerNamespace.metadata.name,
    },
    "spec": {
        "ports": [
            {
                "port": 80,
                "protocol": "TCP",
                "targetPort": 4654
            }
        ],
        "selector": {
            "k8s-app": "skooner"
        },
        "type": "ClusterIP"
    }
}, {
    ...commonOpts,
    dependsOn: skoonerNamespace
})

const serviceAccount = new ServiceAccount("skooner-sa", {
    namespace: skoonerNamespace.metadata.name
}, commonOpts)

const ingress = new k8s.networking.v1.Ingress("skooner-ingress", {
    metadata: {
        name: "skooner",
        namespace: skoonerNamespace.metadata.name,
        annotations: {
            'pulumi.com/skipAwait': 'true'
        }
    },
    spec: {
        rules: [{
            host: fqdn,
            http: {
                paths: [{
                    backend: {
                        service: {
                            name: skoonerService.metadata.name,
                            port: {
                                number: 80,
                            },
                        },
                    },
                    path: "/",
                    pathType: "Prefix",
                }],
            },
        }],
    },
}, {
    ...commonOpts,
    dependsOn: skoonerService
});