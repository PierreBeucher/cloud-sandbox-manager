import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { ServiceAccount } from "../components/service-account"
import { getKubernetesProvider, getEksStack } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")

const eksStack = getEksStack(environment)
const oidcProviderUrl = eksStack.getOutput("oidcProviderUrl")
const oidcProviderArn = eksStack.getOutput("oidcProviderArn")
const clusterName = eksStack.getOutput("clusterName")
const k8sProvider = getKubernetesProvider()

// CSI add-on to manage volumes
// Inspired from Pulumi example 
// See https://www.pulumi.com/registry/packages/aws/api-docs/eks/addon/#example-iam-role-for-eks-addon-vpc-cni-with-aws-managed-policy
// IAM Role: https://docs.aws.amazon.com/eks/latest/userguide/csi-iam-role.html (for IAM Role)
// OIDC provider: https://docs.aws.amazon.com/eks/latest/userguide/enable-iam-roles-for-service-accounts.html (for OIDC Provider)
// CSI Driver add-on: https://docs.aws.amazon.com/eks/latest/userguide/managing-ebs-csi.html
const assumeRolePolicy = aws.iam.getPolicyDocumentOutput({
    statements: [{
        actions: ["sts:AssumeRoleWithWebIdentity"],
        effect: "Allow",
        conditions: [
            {
                test: "StringEquals",
                variable: pulumi.interpolate`${oidcProviderUrl}:aud`, // oidcProviderUrl.apply(url => `${url.result}:aud`),
                values: ["sts.amazonaws.com"],
            },
            {
                test: "StringEquals",
                variable: pulumi.interpolate`${oidcProviderUrl}:sub`, // oidcProviderUrl.apply(url => `${url.result}:sub`),
                values: ["system:serviceaccount:kube-system:ebs-csi-controller-sa"],
            },
        ],
        principals: [{
            identifiers: [oidcProviderArn],
            type: "Federated",
        }],
    }],
});

const csiDriverRole = new aws.iam.Role("csi-driver-role", {
    assumeRolePolicy: assumeRolePolicy.json,
    name: `cloud-sandbox-${environment}-csi-driver`,
});

const csiDriverRolePolicyAttachment = new aws.iam.RolePolicyAttachment("csi-driver-role-policy-attachment", {
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy",
    role: csiDriverRole.name,
});

const csiDriverAddon = new aws.eks.Addon("csi-driver-addon", {
    clusterName: clusterName,
    addonName: "aws-ebs-csi-driver",
    serviceAccountRoleArn: csiDriverRole.arn,
    resolveConflicts: "OVERWRITE"
});

// SA to allow admin access from sandbox instances
const sandboxServiceAccount = new ServiceAccount("sandbox-sa", {
    namespace: "kube-system"
}, {
    provider: k8sProvider
})

// Create a StorageClass for AWS EBS
const ebsStorageClass = new k8s.storage.v1.StorageClass("storage-class-ebs", {
    metadata: {
        name: "ebs-sc",
        annotations: {
            "storageclass.kubernetes.io/is-default-class": "true"
        }
    },
    provisioner: "ebs.csi.aws.com",
    volumeBindingMode: "WaitForFirstConsumer",
}, {
    provider: k8sProvider
})

// Network CNI plugin TODO