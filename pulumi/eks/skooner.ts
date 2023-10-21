import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as serviceAccount from "./service-account"

export interface SkoonerArgs {
    namespace: string,
    fqdn: string
}

export class Skooner extends pulumi.ComponentResource {

    readonly serviceAccount: serviceAccount.ServiceAccount

    constructor(name: string, args: SkoonerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("cloud-sandbox-manager:k8s:Skooner", name, {}, opts);

        const commonOpts = {
            provider: opts?.provider,
            parent: this
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
        
        this.serviceAccount = new serviceAccount.ServiceAccount("skooner-sa", {
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
                    host: args.fqdn,
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
    }
}