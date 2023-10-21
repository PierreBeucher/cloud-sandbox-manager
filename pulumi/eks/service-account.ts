import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface ServiceAccountArgs {
    namespace: pulumi.Input<string>,
}

/**
 * K8S Service Account with secret and token
 */
export class ServiceAccount extends pulumi.ComponentResource {

    readonly sa: pulumi.Output<k8s.core.v1.ServiceAccount>
    readonly secret: pulumi.Output<k8s.core.v1.Secret>
    readonly token: pulumi.Output<string>

    constructor(name: string, args: ServiceAccountArgs, opts?: pulumi.ComponentResourceOptions) {
        super("cloud-sandbox-manager:k8s:serviceAccount", name, {}, opts);

        const commonOpts = {
            provider: opts?.provider,
            parent: this
        }

        const sa = new k8s.core.v1.ServiceAccount(`${name}`, {
            metadata: { 
                name: name,
                namespace: args.namespace
            }
        }, commonOpts)

        this.sa = pulumi.output(sa)
        
        new k8s.rbac.v1.ClusterRoleBinding(`${name}-clusterrolebinding`, {
            "metadata": {
                "name": `${name}`,
            },
            "roleRef": {
                "apiGroup": "rbac.authorization.k8s.io",
                "kind": "ClusterRole",
                "name": "cluster-admin"
            },
            "subjects": [
                {
                    "kind": "ServiceAccount",
                    "name": this.sa.metadata.name,
                    "namespace": args.namespace
                }
            ]
        }, {
            ...commonOpts,
            dependsOn: this.sa,
        })
        
        // secret token value is added by K8S after creation
        // let's get the secret afterward to retrieve token
        const secretWithAnnotation = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}`,
                namespace: args.namespace,
                annotations: {
                    "kubernetes.io/service-account.name": this.sa.metadata.name
                }
            },
            type: "kubernetes.io/service-account-token"
        }, {
            ...commonOpts,
            dependsOn: this.sa,
        })

        this.secret = pulumi.all([args.namespace, secretWithAnnotation.metadata.name]).apply(([ns, sname]) => {
            return k8s.core.v1.Secret.get(`${name}-secret-with-data`, `${ns}/${sname}`, commonOpts)
        })
        
        this.token = this.secret.data["token"].apply(b64token => {
            return Buffer.from(b64token, "base64").toString()
        })
        
        


    }
}