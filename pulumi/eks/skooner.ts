import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface SkoonerArgs {
    namespace: string,
    fqdn: string
}

export class Skooner extends pulumi.ComponentResource {
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
            dependsOn: skoonerNamespace,
            provider: opts?.provider
        })
        
        const skoonerServiceAccount = new k8s.core.v1.ServiceAccount("skooner-sa", {
            metadata: { 
                name: "skooner",
                namespace: skoonerNamespace.metadata.name
            }
        }, {
            ...commonOpts,
            dependsOn: skoonerNamespace,    
            provider: opts?.provider
        })
        
        const skoonerClusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("skooner-clusterrolebinding", {
            "metadata": {
                "name": "skooner-sa",
            },
            "roleRef": {
                "apiGroup": "rbac.authorization.k8s.io",
                "kind": "ClusterRole",
                "name": "cluster-admin"
            },
            "subjects": [
                {
                    "kind": "ServiceAccount",
                    "name": skoonerServiceAccount.metadata.name,
                    "namespace": skoonerNamespace.metadata.name
                }
            ]
        }, {
            ...commonOpts,
            dependsOn: skoonerServiceAccount,
            provider: opts?.provider
        })
        
        const skoonerServiceAccountSecret = new k8s.core.v1.Secret("skooner-sa-secret", {
            metadata: {
                name: "skooner-sa",
                namespace: skoonerNamespace.metadata.name,
                annotations: {
                    "kubernetes.io/service-account.name": skoonerServiceAccount.metadata.name
                }
            },
            type: "kubernetes.io/service-account-token"
        }, {
            ...commonOpts,
            dependsOn: skoonerServiceAccount,
        })

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