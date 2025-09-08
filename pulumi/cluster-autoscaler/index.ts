import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { getKubernetesProvider, getPulumiStackRef } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")

const eksStack = getPulumiStackRef("cloud-sandbox-eks", environment)
const oidcProviderUrl = eksStack.getOutput("oidcProviderUrl")
const oidcProviderArn = eksStack.getOutput("oidcProviderArn")
const clusterName = eksStack.getOutput("clusterName")

const k8sProvider = getKubernetesProvider()

const k8sResourceOpts = {
    provider: k8sProvider
}

//
// Cluster Autoscaler IAM
//
const clusterAutoscalerPolicy = new aws.iam.Policy("cluster-autoscaler-policy", {
    description: "EKS Cluster Autoscaler",
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: [
                    "autoscaling:DescribeAutoScalingGroups",
                    "autoscaling:DescribeAutoScalingInstances",
                    "autoscaling:DescribeLaunchConfigurations",
                    "autoscaling:DescribeScalingActivities",
                    "autoscaling:DescribeTags",
                    "ec2:DescribeImages",
                    "ec2:DescribeInstanceTypes",
                    "ec2:DescribeLaunchTemplateVersions",
                    "ec2:GetInstanceTypesFromInstanceRequirements",
                    "eks:DescribeNodegroup"
                ],
                Resource: "*",
            }, {
                Effect: "Allow",
                Action: [
                    "autoscaling:SetDesiredCapacity",
                    "autoscaling:TerminateInstanceInAutoScalingGroup"
                ],
                Resource: ["*"]
            }
        ],
    }),
});

const clusterAutoscalerAssumeRolePolicy = aws.iam.getPolicyDocumentOutput({
    statements: [
        {
            actions: ["sts:AssumeRoleWithWebIdentity"],
            effect: "Allow",
            principals: [
                {
                    type: "Federated",
                    identifiers: [oidcProviderArn],
                },
            ],
            conditions: [
                {
                    test: "StringEquals",
                    variable: pulumi.interpolate`${oidcProviderUrl}:sub`,
                    values: ["system:serviceaccount:kube-system:cluster-autoscaler"],
                },
            ],
        },
    ],
});

const clusterAutoscalerRole = new aws.iam.Role("cluster-autoscaler-role", {
    name: `cloud-sandbox-${environment}-cluster-autoscaler`,
    assumeRolePolicy: clusterAutoscalerAssumeRolePolicy.json,
});

const clusterAutoscalerRolePolicyAttachment = new aws.iam.RolePolicyAttachment("cluster-autoscaler-policy-attachment", {
    policyArn: clusterAutoscalerPolicy.arn,
    role: clusterAutoscalerRole.name,
});

//
// Cluster Autoscaler chart
//
const clusterAutoscalerServiceAccount = new k8s.core.v1.ServiceAccount("cluster-autoscaler-sa", {
    metadata: {
        name: "cluster-autoscaler",
        namespace: "kube-system",
        annotations: {
            "eks.amazonaws.com/role-arn": clusterAutoscalerRole.arn,
        },
    },
}, k8sResourceOpts);

const clusterAutoscaler = new k8s.helm.v3.Release("cluster-autoscaler", {
    name: "cluster-autoscaler",
    chart: "cluster-autoscaler",
    version: "9.50.1",
    repositoryOpts: {
        repo: "https://kubernetes.github.io/autoscaler",
    },
    namespace: "kube-system",
    values: {
        cloudProvider: "aws",
        autoDiscovery: {
            clusterName: clusterName,
        },
        awsRegion: aws.getRegion().then(r => r.name),
        rbac: {
            serviceAccount: {
                create: false,
                name: clusterAutoscalerServiceAccount.metadata.name,
            },
        },
        extraArgs: {
            // Scale down aggressively
            "scale-down-delay-after-add": "5s",
            "scale-down-delay-after-delete": "5s",
            "scale-down-unneeded-time": "5s",
            "scan-interval": "10s",
        },
    },
}, k8sResourceOpts);
